// 車庫手勢、滑鼠是否照主地圖：真的送滑鼠與觸控事件，量鏡頭（yaw／仰角／縮放）與畫面上的地面怎麼動。
// 地面的位置看 canvas 的 data-focus／data-probe：renderer 用 three 的鏡頭把焦點與旁邊兩點投到畫面上（正交鏡頭下地面對畫面是仿射），
// 不經過 train-garage.js 的手勢換算，所以「手指下那點的地面有沒有跟著手指」是獨立量到的。
// 用法：GARAGE_URL=http://127.0.0.1:5198/ node scripts/verify_garage_map_gestures.mjs（無視窗 Chrome）
import {chromium} from 'playwright';
const BASE=process.env.GARAGE_URL||'http://127.0.0.1:5198/';
const results=[],check=(name,pass,detail)=>{results.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snap=(p,sel)=>p.locator(sel).evaluate(c=>({yaw:+c.dataset.yaw,elevation:+c.dataset.elevation,zoom:+c.dataset.zoom,focus:JSON.parse(c.dataset.focus||'null'),probe:JSON.parse(c.dataset.probe||'null'),pan:JSON.parse(c.dataset.pan||'null'),mode:c.dataset.mode,w:c.clientWidth,h:c.clientHeight}));
// 地面（過焦點的水平面）上的點 ↔ canvas 內的 CSS px。
const toScreen=(s,g)=>{const [F,X,Y]=s.probe,dx=g[0]-s.focus[0],dy=g[1]-s.focus[1];return[F[0]+dx*(X[0]-F[0])+dy*(Y[0]-F[0]),F[1]+dx*(X[1]-F[1])+dy*(Y[1]-F[1])];};
const toGround=(s,q)=>{const [F,X,Y]=s.probe,a=X[0]-F[0],b=Y[0]-F[0],c=X[1]-F[1],d=Y[1]-F[1],det=a*d-b*c,u=q[0]-F[0],v=q[1]-F[1];return[s.focus[0]+(d*u-b*v)/det,s.focus[1]+(-c*u+a*v)/det];};
const off=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),deg=Math.PI/180,near=(a,b,t)=>Math.abs(a-b)<=t;
const route=p=>p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===new URL(BASE).origin)return r.continue();if(u.pathname.includes('style')||u.pathname.endsWith('/liberty')||u.pathname.endsWith('/dark'))return r.fulfill({json:{version:8,sources:{},layers:[]}});return r.abort();});

async function open(b,mobile){
  const c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:940},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',deviceScaleFactor:mobile?3:1}),p=await c.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));await route(p);
  await p.goto(BASE+'?garage=demo&lang=zh-TW');await p.waitForFunction(()=>document.querySelector('.g-view')?.dataset.rendered);
  return{c,p,errors};
}
async function view(p,mode,mobile){
  const tap=async sel=>{await p.locator(sel).scrollIntoViewIfNeeded();if(mobile)await p.tap(sel);else await p.click(sel);await settle(p);};
  if(mode==='scene'){await tap('[data-view="scene"]');await p.waitForFunction(()=>document.querySelector('.g-sf-view')?.dataset.mode==='scene'&&document.querySelector('.g-sf-view').dataset.probe&&document.querySelector('.g-sf-loading').hidden);await settle(p);return'.g-sf-view';}
  await tap('[data-view="'+mode+'"]');await p.waitForFunction(m=>document.querySelector('.g-view').dataset.mode===m&&document.querySelector('.g-fallback').hidden,mode);
  await tap('.g-reset-view');await p.locator('.g-view').scrollIntoViewIfNeeded();await settle(p);return'.g-view';
}
const reset=async(p,sel)=>{await p.locator(sel==='.g-view'?'.g-reset-view':'.g-sf-reset').evaluate(b=>b.click());await settle(p);};

async function desktop(b){
  const {c,p,errors}=await open(b,false);
  for(const mode of ['model','loop','track','scene']){
    const sel=await view(p,mode,false),box=await p.locator(sel).boundingBox(),cx=box.width/2,cy=box.height/2,abs=q=>[box.x+q[0],box.y+q[1]],ortho=mode!=='track',name='桌面 '+mode;
    const drag=async(from,to,{button='left',ctrl=false,hold=true}={})=>{
      if(ctrl)await p.keyboard.down('Control');await p.mouse.move(...abs(from));await p.mouse.down({button});await p.mouse.move(...abs(to),{steps:8});
      if(hold)await p.waitForTimeout(250);await settle(p);const s=await snap(p,sel);await p.mouse.up({button});if(ctrl)await p.keyboard.up('Control');await settle(p);return s;};
    // 左鍵拖＝平移：按下那點的地面跟著游標走，角度、縮放不變。
    let s0=await snap(p,sel);const P=[cx-90,cy+40],Q=[cx-30,cy+10],g=toGround(s0,P);let s=await drag(P,Q);
    // 海岸行旅是透視鏡頭（地面對畫面不是仿射），只看方向：往右拖＝鏡頭往左（焦點 x 變小）。
    check(name+' 左鍵拖＝平移，地面跟著游標',(ortho?off(toScreen(s,g),Q)<1.5:s.pan[0]<s0.pan[0])&&s.yaw===s0.yaw&&s.elevation===s0.elevation&&s.zoom===s0.zoom,{miss:ortho?+off(toScreen(s,g),Q).toFixed(2):s.pan,yaw:[s0.yaw,s.yaw]});
    // 放手前還在動：照地圖的慣性多滑一段，方向不變。瀏覽器同一幀的移動會併成一筆，所以每 16 ms 動一步、最後一步後馬上放開。
    await reset(p,sel);s0=await snap(p,sel);await p.mouse.move(...abs([cx-60,cy]));await p.mouse.down();
    for(let i=1;i<=6;i++){await p.mouse.move(...abs([cx-60+i*12,cy]));await p.waitForTimeout(16);}
    await p.mouse.up();await settle(p);s=await snap(p,sel);await p.waitForTimeout(900);const slid=await snap(p,sel);
    check(name+' 放手後平移有慣性',ortho?toScreen(slid,s0.focus)[0]>toScreen(s,s0.focus)[0]+2:slid.pan[0]<s.pan[0]-.01,ortho?{at:toScreen(s,s0.focus)[0],after:toScreen(slid,s0.focus)[0]}:{at:s.pan,after:slid.pan});
    // 右鍵拖：畫面中心下方往右＝畫面逆時針（yaw 變小），上方往右＝順時針；0.8°/px。
    const limit=mode==='track'?.2:Infinity;
    await reset(p,sel);s0=await snap(p,sel);s=await drag([cx-25,cy+60],[cx+25,cy+60],{button:'right'});
    check(name+' 右鍵在中心下方往右拖＝畫面逆時針 0.8°/px',near(s.yaw-s0.yaw,-Math.min(limit,50*.8*deg),1e-6)&&s.elevation===s0.elevation,{dyaw:s.yaw-s0.yaw});
    await reset(p,sel);s0=await snap(p,sel);s=await drag([cx-25,cy-60],[cx+25,cy-60],{button:'right'});
    check(name+' 右鍵在中心上方往右拖＝畫面順時針',near(s.yaw-s0.yaw,Math.min(limit,50*.8*deg),1e-6),{dyaw:s.yaw-s0.yaw});
    await reset(p,sel);s0=await snap(p,sel);s=await drag([cx-25,cy+60],[cx+25,cy+60],{ctrl:true});
    check(name+' Ctrl＋左鍵拖跟右鍵一樣',near(s.yaw-s0.yaw,-Math.min(limit,50*.8*deg),1e-6),{dyaw:s.yaw-s0.yaw});
    // 右鍵往上拖＝鏡頭放低 0.5°/px（夾在這一格的仰角範圍）。
    await reset(p,sel);s0=await snap(p,sel);s=await drag([cx,cy+20],[cx,cy-10],{button:'right'});
    const low={model:.08,loop:.25,track:.08,scene:.2}[mode];
    check(name+' 右鍵往上拖＝鏡頭放低 0.5°/px',near(s.elevation,Math.max(low,s0.elevation-15*deg),1e-6)&&s.yaw===s0.yaw,{elevation:[s0.elevation,s.elevation]});
    await reset(p,sel);s0=await snap(p,sel);s=await drag([cx,cy],[cx+40,cy+30],{button:'middle'});
    check(name+' 中鍵拖不動',s.yaw===s0.yaw&&s.elevation===s0.elevation&&s.zoom===s0.zoom&&JSON.stringify(s.pan)===JSON.stringify(s0.pan));
    // 滾輪以游標為準：一格（deltaY −100）放大 2/(1+e^(−100/450)) 倍，游標下的地面不動。
    await reset(p,sel);s0=await snap(p,sel);const W=[cx+110,cy-45],gw=toGround(s0,W);await p.mouse.move(...abs(W));await p.mouse.wheel(0,-100);await p.waitForTimeout(700);s=await snap(p,sel);
    check(name+' 滾輪以游標為準縮放',near(s.zoom/s0.zoom,2/(1+Math.exp(-100/450)),.004)&&(ortho?off(toScreen(s,gw),W)<1.5:true),{ratio:s.zoom/s0.zoom,miss:ortho?off(toScreen(s,gw),W):'-'});
    // 雙擊放大一級（上限照這一格），點的那個地方不動。
    await reset(p,sel);s0=await snap(p,sel);const D=[cx-120,cy+30],gd=toGround(s0,D);await p.mouse.dblclick(...abs(D));await p.waitForTimeout(600);s=await snap(p,sel);
    check(name+' 雙擊放大一級、點的地方不動',near(s.zoom,Math.min(mode==='scene'?1.8:3,s0.zoom*2),1e-6)&&(ortho?off(toScreen(s,gd),D)<1.5:true),{zoom:s.zoom,miss:ortho?off(toScreen(s,gd),D):'-'});
    // 平移有邊界：拖很遠，焦點停在範圍內，畫面中心還在車或場景上；⌂ 歸零。
    await reset(p,sel);s0=await snap(p,sel);for(let i=0;i<4;i++)await drag([cx-300,cy],[cx+300,cy]);s=await snap(p,sel);const far=await snap(p,sel);await reset(p,sel);const back=await snap(p,sel);
    check(name+' 平移拖不出範圍、⌂ 歸零',Math.hypot(...far.pan)>0&&Math.hypot(...far.pan)<60&&back.pan[0]===0&&back.pan[1]===0,{far:far.pan});
    if(mode!=='scene'){await p.locator(sel).focus();s0=await snap(p,sel);await p.keyboard.press('ArrowLeft');await settle(p);s=await snap(p,sel);check(name+' 鍵盤 ← 照舊轉向',near(s.yaw-s0.yaw,mode==='track'?Math.max(-.15,-Math.PI/2-.2-s0.yaw):-.15,1e-9),{dyaw:s.yaw-s0.yaw});}
    if(mode==='scene')await p.locator('.g-sf-leave').click();
  }
  check('桌面 無 JS 錯誤',!errors.length,errors);await c.close();
}

async function touch(b){
  const {c,p,errors}=await open(b,true),cdp=await c.newCDPSession(p);
  const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id}))});
  for(const mode of ['model','loop','scene']){
    const sel=await view(p,mode,true),box=await p.locator(sel).boundingBox(),cx=box.width/2,cy=box.height/2,abs=q=>[box.x+q[0],box.y+q[1]],name='觸控 '+mode;
    // 一連串觸控：frames＝每一刻各指的位置（canvas 內 px）；hold＝放手前停 250 ms（不帶慣性），回傳放手前那一刻。
    const gesture=async(frames,hold=true)=>{await send('touchStart',frames[0].map(abs));for(const f of frames.slice(1))await send('touchMove',f.map(abs));if(hold)await p.waitForTimeout(250);await settle(p);const s=await snap(p,sel);await send('touchEnd',[]);await settle(p);return s;};
    let s0=await snap(p,sel);const P=[cx-40,cy+30],g=toGround(s0,P);let s=await gesture([0,1,2,3,4,5].map(i=>[[P[0]+i*8,P[1]-i*5]]));
    check(name+' 單指拖＝平移，地面跟著手指',off(toScreen(s,g),[P[0]+40,P[1]-25])<1.5&&s.yaw===s0.yaw&&s.elevation===s0.elevation,{miss:off(toScreen(s,g),[P[0]+40,P[1]-25])});
    await reset(p,sel);s0=await snap(p,sel);await send('touchStart',[abs([cx-50,cy])]);
    for(let i=1;i<=6;i++){await send('touchMove',[abs([cx-50+i*14,cy])]);await p.waitForTimeout(16);}
    await send('touchEnd',[]);await settle(p);s=await snap(p,sel);await p.waitForTimeout(900);const slid=await snap(p,sel);
    check(name+' 單指甩動放手後有慣性',toScreen(slid,s0.focus)[0]>toScreen(s,s0.focus)[0]+2,{at:toScreen(s,s0.focus)[0],after:toScreen(slid,s0.focus)[0]});
    // 雙指扭轉：畫面順時針轉 60°（前 25 px 弧長是門檻，不算），yaw 變大；兩指中點下的地面不動。
    await reset(p,sel);s0=await snap(p,sel);const M=[cx+20,cy+15],gm=toGround(s0,M),r=60;
    s=await gesture(Array.from({length:13},(_,i)=>{const a=i*5*deg;return[[M[0]+r*Math.cos(a),M[1]+r*Math.sin(a)],[M[0]-r*Math.cos(a),M[1]-r*Math.sin(a)]];}));
    check(name+' 雙指扭轉跟著手指轉、繞兩指中點',s.yaw-s0.yaw>30*deg&&s.yaw-s0.yaw<41*deg&&off(toScreen(s,gm),M)<1.5&&near(s.zoom,s0.zoom,1e-9),{dyaw:(s.yaw-s0.yaw)/deg,miss:off(toScreen(s,gm),M)});
    // 捏合：兩指從相距 80 張到 140，繞中點縮放（距離變 2^0.1 倍之前不算）。
    await reset(p,sel);s0=await snap(p,sel);s=await gesture(Array.from({length:7},(_,i)=>[[M[0]-40-i*5,M[1]],[M[0]+40+i*5,M[1]]]));
    const expect=Math.min(mode==='scene'?1.8:3,s0.zoom*140/85);
    check(name+' 捏合繞兩指中點縮放',near(s.zoom,expect,.01)&&off(toScreen(s,gm),M)<1.5&&s.yaw===s0.yaw,{zoom:s.zoom,expect,miss:off(toScreen(s,gm),M)});
    // 兩指一起往上推 20 px＝鏡頭放低 10°，只改仰角。
    await reset(p,sel);s0=await snap(p,sel);s=await gesture(Array.from({length:5},(_,i)=>[[cx-50,cy+20-i*5],[cx+50,cy+20-i*5]]));
    const low={model:.08,loop:.25,scene:.2}[mode];
    check(name+' 兩指往上推＝鏡頭放低、只改仰角',near(s.elevation,Math.max(low,s0.elevation-10*deg),1e-6)&&s.yaw===s0.yaw&&s.zoom===s0.zoom&&JSON.stringify(s.pan)===JSON.stringify(s0.pan),{elevation:[s0.elevation,s.elevation]});
    // 雙點放大一級、雙指點一下縮小一級，都以點的位置為準。
    await reset(p,sel);s0=await snap(p,sel);const T=[cx-30,cy-20],gt=toGround(s0,T);
    for(let i=0;i<2;i++){await send('touchStart',[abs(T)]);await send('touchEnd',[]);await p.waitForTimeout(80);}await p.waitForTimeout(600);s=await snap(p,sel);
    check(name+' 雙點放大一級、點的地方不動',near(s.zoom,Math.min(mode==='scene'?1.8:3,s0.zoom*2),1e-6)&&off(toScreen(s,gt),T)<1.5,{zoom:s.zoom,miss:off(toScreen(s,gt),T)});
    s0=s;await send('touchStart',[abs([cx-40,cy]),abs([cx+40,cy])]);await send('touchEnd',[]);await p.waitForTimeout(600);s=await snap(p,sel);
    check(name+' 雙指點一下縮小一級',near(s.zoom,Math.max(.7,s0.zoom/2),1e-6),{zoom:[s0.zoom,s.zoom]});
    if(mode==='scene')await p.locator('.g-sf-leave').tap();
  }
  check('觸控 無 JS 錯誤',!errors.length,errors);await cdp.detach();await c.close();
}

const b=await chromium.launch({channel:'chrome',headless:true});
try{await desktop(b);await touch(b);}catch(e){check('手勢量測',false,e.stack);}finally{await b.close();}
console.log(`${results.filter(r=>r.pass).length}/${results.length} 通過`);if(results.some(r=>!r.pass))process.exitCode=1;
