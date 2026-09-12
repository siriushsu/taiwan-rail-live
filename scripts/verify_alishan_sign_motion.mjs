import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const baseline=process.env.SIGN_BASELINE==='1';
const out='output/alishan-sign-motion'+(baseline?'-baseline':'');mkdirSync(out,{recursive:true});const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1.5});
  if(baseline){const old=execFileSync('git',['show','b79b9822:rail-3d/garage-scenes/alishan-turnouts.js'],{encoding:'utf8'});await page.route('**/alishan-turnouts.js?*',r=>r.fulfill({contentType:'text/javascript',body:old}));}
  await page.goto('http://127.0.0.1:5291/prototypes/garage-alishan/');await page.waitForFunction(()=>window.alishanPreview?.state.ready);await page.click('#play');await page.click('[data-view="train"]');
  const samples=await page.evaluate(async()=>{
   const api=alishanPreview,end=api.state.stages[0].travel,canvas=document.querySelector('#scene'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d'),rows=[];
   for(let i=0;i<=8;i++){
    api.setTime(end-4+i*.4);
    // 機車經過時會正常遮住牌底；暫隱車體取樣以分離遮擋與牌面閃爍，鏡頭仍沿行駛位置移動。
    api.trainVisible(false);ctx.drawImage(canvas,0,0);
    const colors=[-.18,.17].map(dz=>{const p=api.project([11.2,-3.251,5.25+dz]);const rgb=[...ctx.getImageData(Math.round(p.x),Math.round(p.y),1,1).data].slice(0,3);return{point:p,rgb};});
    api.trainVisible(true);rows.push({time:api.state.time,moving:api.state.pose.moving,turning:api.state.turnouts[0].moving,colors});await new Promise(r=>requestAnimationFrame(r));
   }
   return rows;
  });
  const stable=samples.every(s=>s.moving&&!s.turning&&s.colors[0].rgb.reduce((a,b)=>a+b,0)>s.colors[1].rgb.reduce((a,b)=>a+b,0)*.8);
  const dark=samples.some(s=>s.colors[0].rgb[0]>0&&s.colors[0].rgb.reduce((a,b)=>a+b,0)<s.colors[1].rgb.reduce((a,b)=>a+b,0)*.8);const pass=baseline?dark:stable;results.push({engine,pass,baseline,samples});console.log(pass?'PASS':'FAIL',engine,baseline?'舊版對照可重現柱面黑色條紋':'跟車移動中，牌面原支柱交疊處不出現黑色條紋',JSON.stringify(samples.map(s=>s.colors.map(c=>c.rgb))));
  await page.screenshot({path:`${out}/${engine}-follow.png`});
 }finally{await browser.close();}
}
writeFileSync(`${out}/verification.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
