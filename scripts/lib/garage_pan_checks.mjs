// 車庫原型頁的鏡頭平移驗收，四頁共用：右鍵／Shift 拖曳、Shift＋方向鍵、真雙指拖曳（chromium 走 CDP 觸控）、重設歸零、跟車視角的偏移跟著車走、偏移有上限。
// 每條判準都對「固定世界點的投影位移」量，不讀設定值；轉視角的對照組證明左鍵與單指沒有被改成平移。
export async function panChecks({b,engine,URL,api,check,settle,trainTarget=c=>[c[0],c[1],c[2]+1.4]}){
 const p=await b.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,300));});await p.goto(URL);try{await p.waitForFunction(a=>window[a]?.state.ready,api,{timeout:90000});}catch(e){throw Error('開頁逾時 '+JSON.stringify({loading:await p.evaluate(()=>document.querySelector('#loading')?.textContent),errors}));}
 const st=()=>p.evaluate(a=>window[a].state,api),project=pt=>p.evaluate(([a,pt])=>window[a].project(pt),[api,pt]);
 if((await st()).running)await p.click('#play');   // 先暫停：位置全用 setTime／setDistance 推，量測之間車不准自己動
 await p.click('[data-view="world"]');await p.click('#reset');await settle(p);
 const box=await p.locator('#scene').boundingBox(),x0=box.x+box.width/2,y0=box.y+box.height/2,P1=[10,0,0],P2=[-10,5,0];
 const drag=async(button,dx,dy,mod)=>{await p.mouse.move(x0-dx/2,y0-dy/2);if(mod)await p.keyboard.down(mod);await p.mouse.down({button});await p.mouse.move(x0+dx/2,y0+dy/2,{steps:4});await p.mouse.up({button});if(mod)await p.keyboard.up(mod);await settle(p);};
 const shifted=(a,b,dx,dy)=>Math.abs(a.x-b.x-dx)<3&&Math.abs(a.y-b.y-dy)<3,delta=(a,b)=>[+(a.x-b.x).toFixed(1),+(a.y-b.y).toFixed(1)];
 const b1=await project(P1),b2=await project(P2);
 await drag('right',120,60);const s1=await st(),a1=await project(P1),a2=await project(P2);
 check(engine+' 平移：右鍵拖曳 (120,60) 像素，兩個固定點都剛好跟著移 (120,60)（純平移、沒轉視角）',shifted(a1,b1,120,60)&&shifted(a2,b2,120,60)&&Math.hypot(s1.pan.x,s1.pan.y)>0,{d1:delta(a1,b1),d2:delta(a2,b2),pan:s1.pan});
 check(engine+' 平移：右鍵不跳出瀏覽器選單',await p.evaluate(()=>{const ev=new MouseEvent('contextmenu',{cancelable:true,bubbles:true});document.querySelector('#scene').dispatchEvent(ev);return ev.defaultPrevented;}));
 await drag('left',120,60);const s2=await st(),c1=await project(P1);
 check(engine+' 平移：左鍵拖曳仍是轉視角，偏移不變、固定點不是被平移過去（正向對照）',s2.pan.x===s1.pan.x&&s2.pan.y===s1.pan.y&&!shifted(c1,a1,120,60)&&(c1.x!==a1.x||c1.y!==a1.y),{pan:s2.pan,moved:delta(c1,a1)});
 await drag('left',120,60,'Shift');const s3=await st();
 check(engine+' 平移：Shift＋左鍵拖曳也平移',s3.pan.x!==s2.pan.x||s3.pan.y!==s2.pan.y,{before:s2.pan,after:s3.pan});
 await p.click('#reset');await settle(p);const s4=await st(),r1=await project(P1),r2=await project(P2);
 check(engine+' 平移：重設視角把偏移歸零、固定點回到原位',s4.pan.x===0&&s4.pan.y===0&&shifted(r1,b1,0,0)&&shifted(r2,b2,0,0),{pan:s4.pan,d1:delta(r1,b1),d2:delta(r2,b2)});
 await p.locator('#scene').focus();await p.keyboard.down('Shift');await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowUp');await p.keyboard.up('Shift');await settle(p);const k1=await project(P1),s5=await st();
 check(engine+' 平移：Shift＋方向鍵 →↑ 鏡頭往右上移，畫面往左下各 40 像素',shifted(k1,b1,-40,40)&&Math.hypot(s5.pan.x,s5.pan.y)>0,{d:delta(k1,b1),pan:s5.pan});
 await p.keyboard.press('ArrowRight');await settle(p);const s6=await st(),k2=await project(P1);
 check(engine+' 平移：沒按 Shift 的方向鍵仍是轉視角，偏移不變（正向對照）',s6.pan.x===s5.pan.x&&s6.pan.y===s5.pan.y&&(k2.x!==k1.x||k2.y!==k1.y),{pan:s6.pan,moved:delta(k2,k1)});
 await p.click('#reset');await settle(p);
 for(let i=0;i<12;i++)await drag('right',300,0);const s7=await st();
 check(engine+' 平移：一直拖不會把場景弄丟（偏移有上限 40）',Math.max(Math.abs(s7.pan.x),Math.abs(s7.pan.y))===40,{pan:s7.pan});
 await p.click('[data-view="train"]');await settle(p);const s8=await st();
 const centre=async()=>{const s=await st(),n=s.poses.length,c=s.poses.reduce((a,c)=>[a[0]+c.x/n,a[1]+c.y/n,a[2]+c.z/n],[0,0,0]);return project(trainTarget(c));};
 const t0=await centre();await drag('right',100,0);const t1=await centre();
 await p.evaluate(a=>{const o=window[a];if(o.setTime)o.setTime(o.state.time+3);else o.setDistance(o.state.distance+6);},api);await settle(p);const t2=await centre(),s9=await st();
 check(engine+' 平移：跟車視角平移 100 像素後鏡頭仍跟著車走（車在畫面上停在同一個位置）',s8.pan.x===0&&s8.pan.y===0&&shifted(t1,t0,100,0)&&Math.abs(t2.x-t1.x)<2&&Math.abs(t2.y-t1.y)<2&&s9.view==='train',{afterPan:delta(t1,t0),afterMove:delta(t2,t1),pan:s9.pan});
 await p.close();
 if(engine==='chromium'){
  const m=await b.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,isMobile:true,hasTouch:true});m.on('pageerror',e=>errors.push(e.message));
  await m.goto(URL);await m.waitForFunction(a=>window[a]?.state.ready,api,{timeout:90000});const ms=()=>m.evaluate(a=>window[a].state,api);if((await ms()).running)await m.tap('#play');await m.tap('[data-view="world"]');await m.tap('#reset');await settle(m);
  const mb=await m.locator('#scene').boundingBox(),x=mb.x+mb.width/2,y=mb.y+mb.height/2,client=await m.context().newCDPSession(m),z0=(await ms()).zoom;
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x-30,y},{id:2,x:x+30,y}]});
  for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x-30+6*i,y:y+5*i},{id:2,x:x+30+14*i,y:y+5*i}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(m);const g1=await ms();
  check(engine+' 平移：真雙指一邊張開一邊拖，同時放大與平移（觸控）',g1.zoom>z0*1.3&&Math.hypot(g1.pan.x,g1.pan.y)>0,{zoom:g1.zoom,pan:g1.pan});
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+20,y:y-10}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(m);const g2=await ms();
  check(engine+' 平移：單指拖曳仍是轉視角、不平移不縮放（觸控正向對照）',g2.pan.x===g1.pan.x&&g2.pan.y===g1.pan.y&&g2.zoom===g1.zoom,{pan:g2.pan,zoom:g2.zoom});
  await client.detach();await m.close();
 }
 check(engine+' 平移：過程無 JS 錯誤',errors.length===0,errors);
}
