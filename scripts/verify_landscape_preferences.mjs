import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5228/';
let failed=0,count=0;
function check(name,yes){count++;console.log((yes?'PASS ':'FAIL ')+name);if(!yes)failed++;}
for(const [name,engine]of Object.entries({chromium,webkit})){
 const b=await engine.launch({headless:false}),p=await b.newPage({viewport:{width:1000,height:800},locale:'zh-TW'});
 await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 await p.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await p.goto(base+'?map=landscape&ground=flat&g=all&at=24.9971,121.5784&z=17.5&lang=zh-TW');
 await p.waitForFunction(()=>state.ready&&railIslandIntegration.renderer&&!railIslandIntegration.loading,null,{timeout:60000});
 check(name+' 無選車深連結進地景',await p.evaluate(()=>state.basemap==='landscape'&&M.getStyleKind()==='landscape'));
 check(name+' 平坦深連結保留',await p.evaluate(()=>railIslandIntegration.groundMode==='flat'&&!M.raw.getTerrain()));
 await p.evaluate(()=>{railIslandIntegration.setInspection(true);setBasemap();});await p.waitForTimeout(300);
 check(name+' 同底圖重套不覆蓋透視設定',await p.evaluate(()=>M.raw.getPaintProperty('building-3d','fill-extrusion-opacity')===.24));
 await p.evaluate(()=>clearFollow());await p.reload();await p.waitForFunction(()=>state.ready&&railIslandIntegration.renderer&&!railIslandIntegration.loading,null,{timeout:60000});
 check(name+' 清除跟車網址後重整仍為地景',await p.evaluate(()=>state.basemap==='landscape'&&M.getStyleKind()==='landscape'));
 await p.evaluate(()=>{chooseBasemap('dark');chooseBasemap('landscape');chooseBasemap('light');chooseBasemap('landscape');});
 await p.waitForFunction(()=>M.getStyleKind()==='landscape'&&railIslandIntegration.renderer?.stats.landscape&&!railIslandIntegration.loading,null,{timeout:60000});
 check(name+' 快速切換只留下最後的地景',await p.evaluate(()=>railIslandIntegration.errors.length===0&&M.raw.getPaintProperty('building-3d','fill-extrusion-opacity')===.24));
 await b.close();
}
console.log((count-failed)+'/'+count+' 通過');if(failed)process.exitCode=1;
