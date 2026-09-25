// 側欄模式（手機橫放、觸控平板橫向）的「觀看」鈕位置：右側沒有卡片時留在右上工具列，
// 右側有車站卡／列車卡／跟車欄時移到側欄左邊、而且點得到。
// 09-25 使用者轉述 iPad 橫向「觀看鈕跑到螢幕中央」：原本側欄模式一成立就把鈕移到 --rail-w 左邊，沒看卡片有沒有開。
// 判準只量幾何與真點（鈕在 #mapActions 框內／整顆在側欄左緣之左、中心點打得到自己、點下去面板真的開），
// 不讀 view-side-entry 這個 class——那是實作本身，拿它當判準會跟著一起瞎。
import{chromium,webkit}from'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5248';
let fails=0;const check=(name,pass,detail)=>{if(!pass)fails++;console.log((pass?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail??''));};
// [名稱, 寬, 高, 應為側欄模式, 量跟車與列車卡]
const views=[['iPad 橫向',1180,820,true,true],['手機橫放',844,390,true,true],['iPad 直向（對照）',820,1180,false,false]];
const probe=()=>{
  const b=document.getElementById('viewSettingsBtn'),r=b.getBoundingClientRect(),a=document.getElementById('mapActions').getBoundingClientRect(),cs=getComputedStyle(b);
  const hitEl=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  const vis=(e,q)=>{const s=getComputedStyle(e);return q.width>0&&q.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>=.5;};
  // 右側側欄＝貼齊視窗右緣、高過視窗四成的可見面板，取最左緣。
  let railLeft=null;
  for(const id of[...SHEET_PANEL_IDS,'trainCard','followPanel']){const e=document.getElementById(id);if(!e||e.hidden)continue;const q=e.getBoundingClientRect();if(!vis(e,q)||q.width<150||q.height<innerHeight*.4||q.right<innerWidth-40)continue;railLeft=railLeft==null?q.left:Math.min(railLeft,q.left);}
  const over=[...document.querySelectorAll('#topbar,.tabbar,.controls,#mapActions > *,.maplibregl-ctrl-top-right,.maplibregl-ctrl-bottom-right')].filter(e=>e!==b&&!e.contains(b)&&!b.contains(e)).filter(e=>{const q=e.getBoundingClientRect();return vis(e,q)&&q.left<r.right-1&&q.right>r.left+1&&q.top<r.bottom-1&&q.bottom>r.top+1;}).map(e=>e.id||e.className);
  const R=q=>({l:Math.round(q.left),t:Math.round(q.top),r:Math.round(q.right),b:Math.round(q.bottom)});
  return{btn:R(r),actions:R(a),shown:vis(b,r),hit:!!hitEl&&b.contains(hitEl),inActions:r.left>=a.left-1&&r.right<=a.right+1&&r.top>=a.top-1&&r.bottom<=a.bottom+1,railLeft:railLeft==null?null:Math.round(railLeft),over,cls:['sheet-open','train-open','follow-on'].filter(c=>document.body.classList.contains(c))};
};
const leftOfRail=m=>m.railLeft!=null&&m.btn.r<=m.railLeft-2&&m.hit&&m.over.length===0;
const inColumn=m=>m.shown&&m.inActions&&m.hit&&m.over.length===0;
for(const[engine,type]of Object.entries({chromium,webkit})){
  const browser=await type.launch();
  try{
    for(const[name,w,h,side,full]of views){
      const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,locale:'zh-TW'});
      await ctx.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
      const p=await ctx.newPage(),tag=`${engine} ${name} ${w}×${h}`;
      const boot=async q=>{await p.goto(base+'/?lang=zh-TW&t=12:00'+q);await p.waitForFunction(()=>typeof state!=='undefined'&&state.ready&&!!window.railViewControls,null,{timeout:60000});await p.evaluate(()=>{state.playing=false;});await p.waitForTimeout(300);};
      // 真點一次：面板要真的打開，再收回去給下一格用。
      const tapOpens=async()=>{await p.tap('#viewSettingsBtn');const ok=await p.evaluate(()=>document.body.classList.contains('view-open')&&!document.getElementById('viewSettingsPanel').hidden);await p.evaluate(()=>railViewControls.close());return ok;};
      await boot('');
      // 正向對照：這一格真的是預期的版面模式，否則下面量的是別的版面。
      const env=await p.evaluate(()=>({mobile:document.body.classList.contains('mobile-shell'),side:sheetIsSideRail()}));
      check(`${tag} 版面模式`,env.mobile&&env.side===side,env);
      let m=await p.evaluate(probe);
      check(`${tag} 沒開卡片：觀看鈕在右上工具列`,m.cls.length===0&&inColumn(m)&&await tapOpens(),m);
      const opened=await p.evaluate(()=>{const st=state.schedStations.find(s=>s.name.includes('臺北'));if(st)openBoard(st);return !!st;});
      await p.waitForTimeout(400);m=await p.evaluate(probe);
      if(side)check(`${tag} 開車站卡：觀看鈕在側欄左邊且點得到`,opened&&m.cls.includes('sheet-open')&&leftOfRail(m)&&await tapOpens(),m);
      else check(`${tag} 開車站卡：觀看鈕仍在工具列且點得到`,opened&&m.cls.includes('sheet-open')&&inColumn(m)&&await tapOpens(),m);
      await p.evaluate(()=>closeBoard());await p.waitForTimeout(400);m=await p.evaluate(probe);
      check(`${tag} 關掉車站卡：觀看鈕回到工具列`,m.cls.length===0&&inColumn(m),m);
      if(full){
        await boot('&train=117');await p.waitForFunction(()=>!!state.followTrain,null,{timeout:60000});await p.waitForTimeout(600);m=await p.evaluate(probe);
        // 跟車欄收成膠囊時沒有 follow-on，鈕就該留在工具列；有 follow-on 才要讓到欄左邊。
        check(`${tag} 跟車中：觀看鈕點得到${m.cls.includes('follow-on')?'（在跟車欄左邊）':'（在工具列）'}`,(m.cls.includes('follow-on')?leftOfRail(m):inColumn(m))&&await tapOpens(),m);
        const ts=await p.evaluate(()=>{openTrainSheet();return document.body.classList.contains('train-open');});
        await p.waitForTimeout(400);m=await p.evaluate(probe);
        check(`${tag} 開列車卡：觀看鈕在側欄左邊且點得到`,ts&&leftOfRail(m)&&await tapOpens(),m);
      }
      await ctx.close();
    }
  }catch(e){check(engine+' 完成',false,String(e.stack||e));}finally{await browser.close();}
}
if(fails){console.log(`FAIL ${fails} 項`);process.exitCode=1;}else console.log('PASS 側欄模式觀看鈕位置全部通過');
