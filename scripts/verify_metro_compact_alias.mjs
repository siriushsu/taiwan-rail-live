import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5245/',rows=[];fs.mkdirSync('output/metro-compact',{recursive:true});
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();
 for(const width of [360,375,390,414,520,768]){
  const p=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,locale:'zh-TW'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const check=(test,pass,detail)=>{rows.push({engine,width,test,pass,detail});console.log(engine,width,test,pass,pass?"":JSON.stringify(detail));fs.writeFileSync('output/metro-compact/progress.json',JSON.stringify(rows,null,2));};
  try{
   await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
   await p.goto(base+'?g='+([360,390,520].includes(width)?'metro':'all')+'&t=12:00');await p.waitForFunction(()=>state.ready,null,{timeout:90000});await p.evaluate(()=>M.setView([25.04,121.53],14,{animate:false}));await p.waitForFunction(()=>state._freqHits?.some(h=>h.ln),null,{timeout:30000});
   await p.evaluate(()=>{state.playing=false;const h=state._freqHits.find(h=>h.ln);setFreqFollow(h);});
   await p.locator('#fcClose').tap();check('觸控收合不中斷跟隨',await p.evaluate(()=>!!state.freqFollow&&document.querySelector('#freqCard').classList.contains('fc-min')));
   for(const mode of ['normal','fullscreen','sheet','dark']){
    if(mode==='fullscreen')await p.evaluate(()=>state._setFs(true));
    if(mode==='sheet')await p.evaluate(()=>openRidePanel());
    if(mode==='dark')await p.evaluate(()=>{closeRidePanel();state._setAppearance('dark');});
    const d=await p.evaluate(()=>{const card=document.querySelector('#freqCard'),r=card.getBoundingClientRect(),b=document.querySelector('#fcEnd'),q=b.getBoundingClientRect(),visible=e=>{if(!e.getBoundingClientRect().width)return false;for(let n=e;n&&n instanceof Element;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;}return true;};const others=[...document.querySelectorAll('button,input,select,summary,[role=button]')].filter(e=>!card.contains(e)&&visible(e));return {h:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1,hit:b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)),touch:q.width>=44&&q.height>=44,collisions:others.filter(e=>{const a=e.getBoundingClientRect();return Math.min(a.right,r.right)-Math.max(a.left,r.left)>1&&Math.min(a.bottom,r.bottom)-Math.max(a.top,r.top)>1;}).map(e=>e.id||e.textContent.slice(0,20)),checked:others.length};});
    check(mode+' 單行、觸控與所有控件不重疊',d.h<=70&&!d.overflow&&d.hit&&d.touch&&!d.collisions.length,d);
   }
   await p.locator(await p.locator('#toolsFab').isVisible()?'#toolsFab':'#tabMore').tap();
   const beta=p.locator('#msBasemapSeg [data-map="landscape"]');await beta.scrollIntoViewIfNeeded();
   check('地景標示 Beta 且設定不溢出',await beta.evaluate(e=>e.textContent.includes('Beta')&&document.documentElement.scrollWidth<=innerWidth+1));
   await p.locator('#moreClose').tap();
   await p.locator('#fcLine').tap();check('點膠囊展開',await p.evaluate(()=>!!state.freqFollow&&!document.querySelector('#freqCard').classList.contains('fc-min')));
   await p.locator('#fcClose').tap();await p.locator('#fcEnd').tap();check('精簡卡結束跟隨',await p.evaluate(()=>!state.freqFollow&&document.querySelector('#freqCard').hidden));
   const alias=await p.evaluate(()=>{saveCheckins({v:2,sg:{},st:{old:{sys:'tra_sched',name:'臺北-環島',s:'visit',n:3,d:'2026-09-01',u:1},current:{sys:'tra_sched',name:'臺北',s:'pass',n:2,d:'2026-09-02',u:2},other:{sys:'tra_sched',name:'新左營',s:'visit',n:1,d:'2026-09-02',u:3}}});const c=stationCollection([{sys:'tra_sched',from:'台北－環島',to:'板橋',date:'2026-09-03'}]);return {entries:[...c.values()],html:buildStationStamps([]),key:checkinName('tra_sched','台北環島')};});
   const taipei=alias.entries.filter(e=>e.name==='臺北');check('舊別名章併回臺北且保留次數',taipei.length===1&&taipei[0].n===6&&taipei[0].s==='visit'&&alias.entries.length===3&&!alias.html.includes('環島')&&alias.key==='臺北',alias.entries);
   check('無頁面錯誤',!errors.length,errors);
   if(width===375)await p.screenshot({path:`output/metro-compact/${engine}.png`});
  }catch(e){check('例外',false,String(e));}finally{await p.close();}
 }
 await browser.close();
}
fs.writeFileSync('output/metro-compact/results.json',JSON.stringify(rows,null,2));console.log({total:rows.length,failed:rows.filter(r=>!r.pass)});if(rows.some(r=>!r.pass))process.exitCode=1;
