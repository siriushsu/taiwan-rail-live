import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const url=process.env.GARAGE_ALISHAN_URL||'http://127.0.0.1:5291/prototypes/garage-alishan/';
const out='output/alishan-turnouts';mkdirSync(out,{recursive:true});const results=[];
function check(name,pass,detail){results.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail));}
for(const [engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.alishanPreview?.state.ready);await page.click('#play');
 const movement=await page.evaluate(()=>{const api=alishanPreview;let wrong=0,occupied=0,changesWhileMoving=0,flatError=0;
 for(const stage of api.state.stages)for(const t of [0,stage.travel*.3,stage.travel*.6,stage.travel*.9,stage.travel+.5,stage.travel+1.2,stage.travel+2]){api.setTime(stage.start+t);const s=api.state;
  for(const turnout of s.turnouts){if(turnout.moving){if(s.pose.moving)changesWhileMoving++;const center=api.sample(s.pose.route,s.pose.s);const clearance=Math.abs(center.x-turnout.toe[0])-s.trainLength/2;if(clearance<.5)occupied++;}
   if(s.pose.moving)for(const car of s.poses){const d=(car.x-turnout.toe[0])*(turnout.id===0?-1:1);if(d>=0&&d<7&&Math.abs(car.y-turnout.toe[1])<3&&turnout.route!==s.pose.route)wrong++;}
  }
 }
 for(const [route,x0,x1]of [[0,5,12],[1,5,12],[1,-12,-5],[2,-12,-5]])for(let s=0;s<90;s+=.1){const p=api.sample(route,s);if(p.x>=x0&&p.x<=x1)flatError=Math.max(flatError,Math.abs(p.z-(x0===5?4:8)));}
 return{wrong,occupied,changesWhileMoving,flatError};});
 check(engine+' 六階段行車進路吻合、全列淨空後才轉轍',Object.values(movement).every(v=>v<1e-8),movement);
 for(const index of [0,1,3,4]){
 const evidence=await page.evaluate(async index=>{
  const api=alishanPreview,stage=api.state.stages[index],id=index===0||index===4?0:1;
  const canvas=document.querySelector('#scene'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');
  async function read(){ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,copy.width,copy.height).data;}
  api.setTime(stage.start+stage.travel+.5);const before=api.state,first=await read();
  api.setTime(stage.start+stage.travel+1.2);const middle=api.state;
  api.setTime(stage.start+stage.travel+2);const after=api.state,last=await read();
  const toe=before.turnouts[id].toe,points=[];for(const dx of [-3,3])for(const dy of [-3,3])for(const dz of [0,2])points.push(api.project([toe[0]+dx,toe[1]+dy,toe[2]+dz]));
  const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))),x1=Math.min(copy.width,Math.ceil(Math.max(...points.map(p=>p.x)))),y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),y1=Math.min(copy.height,Math.ceil(Math.max(...points.map(p=>p.y))));
  let pixels=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const k=(y*copy.width+x)*4;if(Math.abs(first[k]-last[k])+Math.abs(first[k+1]-last[k+1])+Math.abs(first[k+2]-last[k+2])>25)pixels++;}
  return{pixels,stopped:JSON.stringify(before.poses)===JSON.stringify(after.poses),middle:middle.turnouts[id],before:before.turnouts[id],after:after.turnouts[id]};
 },index);
 check(engine+` 第 ${index+1} 階段停車轉轍含實際像素`,evidence.stopped&&evidence.pixels>8&&evidence.middle.moving&&Math.abs(evidence.after.indicatorAngle-evidence.before.indicatorAngle)>1.5,evidence);
 if(index<2)await page.screenshot({path:`${out}/${engine}-switch-${index+1}.png`});
 }
 check(engine+' 無瀏覽器例外',errors.length===0,errors);
 }finally{await browser.close();}
}
writeFileSync(`${out}/verification.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
