import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const out='output/sunlight-style';fs.mkdirSync(out,{recursive:true});const results=[];
for(const [name,engine]of Object.entries({chromium,webkit})){
 const b=await engine.launch(),p=await b.newPage({viewport:{width:800,height:700},locale:'zh-TW'}),errors=[];let stage='boot';p.on('pageerror',e=>errors.push({stage,message:e.stack}));
 await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));await p.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
 try{
 await p.goto('http://127.0.0.1:5236/?map=landscape&scene=3d&ground=terrain&at=23.518,120.731&z=12.5&t=08:00&sun=on&lang=zh-TW');
 await p.waitForFunction(()=>state.ready&&railIslandIntegration.renderer&&!railIslandIntegration.loading&&M.raw.queryTerrainElevation([120.731,23.518])>1000,null,{timeout:90000});
 await p.evaluate(()=>{state.playing=false;setSimSec(28800);});
 for(let i=0;i<3;i++)for(const kind of ['light','landscape']){
  stage=i+' '+kind;await p.evaluate(kind=>chooseBasemap(kind),kind);await p.waitForFunction(kind=>M.getStyleKind()===kind&&M.isStyleReady()&&railIslandIntegration.renderer&&!railIslandIntegration.loading,kind,{timeout:60000});await p.waitForTimeout(400);
  const r=await p.evaluate(()=>({kind:M.getStyleKind(),terrain:!!M.raw.getTerrain(),time:state.simSec,paint:M.raw.getLayer('landscape-hillshade')?.serialize().paint,sun:sunlight.current,errors:railIslandIntegration.errors,tick:state._tickErrs||[]}));
  const pass=r.terrain&&r.time===28800&&!r.errors.length&&!r.tick.length&&(kind!=='landscape'||r.paint['hillshade-illumination-direction']===r.sun.azimuth);
  results.push({name:name+' '+stage,pass,errors:r.errors,tick:r.tick});console.log(pass?'PASS':'FAIL',name,stage);
 }
 results.push({name:name+' 無深度／座標 shader 例外',pass:errors.length===0,errors});console.log(errors.length?'FAIL':'PASS',name,JSON.stringify(errors));
 }catch(e){results.push({name:name+' 切換完成',pass:false,error:String(e.stack)});console.log('FAIL',name,e.stack);}finally{await b.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
