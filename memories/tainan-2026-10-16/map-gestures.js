// 3D 畫面（車庫、台南重播）的手勢與滑鼠，照網頁主地圖：MapLibre 5.9.0（vendor/maplibre-gl.js）各 handler 的做法，常數與門檻都是原值。
// 同一份檔案也放在 memories/tainan-2026-09-12/ 與 memories/tainan-2026-10-16/（封存頁不引用目錄外的檔案），改的時候三份一起改。
// 單指、左鍵拖＝平移，地面跟著手指走。右鍵、Ctrl＋左鍵拖＝左右轉向、上下調仰角（往上拖鏡頭放低）；轉向是轉盤式：
// 游標在畫面中心下方往右拖畫面逆時針、上方往右拖順時針，游標離中心上下超過 100 px 時照游標繞中心轉的角度轉。中鍵不動。
// 雙指＝平移＋捏合＋扭轉，都繞兩指中點；兩指一起上下推＝只改仰角（開始時就決定，整個手勢不換）。
// 滾輪以游標為準縮放；雙擊、雙點放大一級，Shift＋雙擊與雙指點一下縮小一級；放手前 160 ms 內有在動就照地圖的慣性滑一段。
// cam.apply({pan,zoom,bearing,pitch,around}) 套一步變化：pan＝[dx,dy] 畫面 px（地面跟著走的量）；zoom＝log2 倍率；
// bearing＝度，正＝畫面逆時針（同地圖 bearing 變大）；pitch＝度，正＝鏡頭放低；around＝[x,y] 相對畫布左上角的 px，沒給＝畫面中心。
// cam.zoomLevel() 回 [目前, 最小, 最大]（log2），滾輪與雙擊用；cam.begin() 在按下時叫。回傳 {halt,stop}：halt 只停慣性與縮放動畫
// （按鈕、鍵盤改鏡頭時叫，同主地圖按鈕的 easeTo 會先停掉進行中的動畫），stop 連進行中的手勢一起清掉。
function bezier(p1x,p1y,p2x,p2y){
  const cx=3*p1x,bx=3*(p2x-p1x)-cx,ax=1-cx-bx,cy=3*p1y,by=3*(p2y-p1y)-cy,ay=1-cy-by;
  const x=t=>((ax*t+bx)*t+cx)*t,slope=t=>(3*ax*t+2*bx)*t+cx;
  return p=>{
    if(p<=0)return 0;if(p>=1)return 1;
    let t=p;for(let i=0;i<8;i++){const e=x(t)-p;if(Math.abs(e)<1e-6)break;const d=slope(t);if(Math.abs(d)<1e-6)break;t-=e/d;}
    if(!(t>=0&&t<=1)||Math.abs(x(t)-p)>=1e-6){let lo=0,hi=1;t=p;for(let i=0;i<40&&Math.abs(x(t)-p)>=1e-6;i++){if(x(t)<p)lo=t;else hi=t;t=(lo+hi)/2;}}
    return((ay*t+by)*t+cy)*t;
  };
}
const EASE=bezier(.25,.1,.25,1),GLIDE=bezier(0,0,.3,1),WHEEL_STEP=4.000244140625;
const PAN={deceleration:2500,maxSpeed:1400},ZOOM={deceleration:20,maxSpeed:1400},BEARING={deceleration:1000,maxSpeed:360},PITCH={deceleration:1000,maxSpeed:90};
// 慣性的量與時間（MapLibre calculateEasing，linearity .3）：ms＝緩衝裡第一筆到最後一筆的時間。
function glide(amount,ms,{deceleration,maxSpeed}){const speed=Math.max(-maxSpeed,Math.min(maxSpeed,amount*.3/(ms/1000))),s=Math.abs(speed)/(deceleration*.3);return{amount:speed*s/2,duration:s*1000};}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],len=v=>Math.hypot(v[0],v[1]),mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const mean=points=>{const list=[...points];return list.reduce((s,p)=>[s[0]+p[0]/list.length,s[1]+p[1]/list.length],[0,0]);};
// a 相對 b 轉了幾度（Point#angleWith，畫面 y 向下時順時針為負）。
const angle=(a,b)=>Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1])*180/Math.PI;
const vertical=v=>Math.abs(v[1])>Math.abs(v[0]);
// 點擊（TapRecognizer）：fingers 指都放上、500 ms 內全放開、每指移動不超過 30 px 算一下；連 count 下、間隔 500 ms、相距 30 px 內才成立。
function taps(fingers,count){
  let centroid=null,start,from=null,aborted=false,last=Infinity,lastAt=null,seen=0;
  const single=()=>{centroid=from=null;start=undefined;aborted=false;},clear=()=>{single();last=Infinity;lastAt=null;seen=0;};
  return{
    down(t,touches){if(centroid||touches.size>fingers)aborted=true;if(aborted)return;start??=t;if(touches.size===fingers){centroid=mean(touches.values());from=new Map(touches);}},
    move(touches){if(aborted||!from)return;for(const [id,p] of from){const q=touches.get(id);if(!q||len(sub(q,p))>30)aborted=true;}},
    up(t,touches){
      if(!centroid||t-start>500)aborted=true;if(touches.size)return null;
      const tap=!aborted&&centroid;single();if(!tap)return null;
      if(!(t-last<500&&(!lastAt||len(sub(lastAt,tap))<30)))clear();
      seen++;last=t;lastAt=tap;if(seen<count)return null;clear();return tap;
    },
    clear,
  };
}

export function attachMapGestures(el,cam){
  const touches=new Map(),panFrom=new Map(),zoomIn=taps(1,2),zoomOut=taps(2,1);
  let mouse=null,two=null,panSum=[0,0],buffer=[],pending=null,anim=null,raf=0,lastTouch=-1e9,menuTimer=0;
  const at=e=>{const r=el.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];};
  const centre=()=>[el.clientWidth/2,el.clientHeight/2];
  const halt=()=>{cancelAnimationFrame(raf);raf=0;anim=null;};
  // 手勢每一步立刻套上；慣性緩衝照地圖每一幀記一筆（同一幀的事件併成一筆，雙指各一個事件不會變成兩筆），只留最近 160 ms。
  function record(){if(!pending)return;cancelAnimationFrame(pending.raf);const t=performance.now();while(buffer.length&&t-buffer[0].t>160)buffer.shift();buffer.push({t,d:pending.d});pending=null;}
  function apply(d){
    cam.apply(d);
    if(!pending)pending={d:{pan:[0,0],zoom:0,bearing:0,pitch:0},raf:requestAnimationFrame(record)};
    const s=pending.d;if(d.pan){s.pan[0]+=d.pan[0];s.pan[1]+=d.pan[1];}s.zoom+=d.zoom||0;s.bearing+=d.bearing||0;s.pitch+=d.pitch||0;if(d.around)s.around=d.around;
  }
  function forget(){if(pending)cancelAnimationFrame(pending.raf);pending=null;buffer=[];}
  // 慣性與雙擊縮放：total 照 easing 分到每一幀。
  function animate(total,duration,easing,around){
    halt();if(!(duration>0))return;
    anim={total,duration,easing,around,start:performance.now(),done:0};raf=requestAnimationFrame(frame);
  }
  function frame(){
    raf=0;if(!anim)return;
    const k=Math.min(1,(performance.now()-anim.start)/anim.duration),e=anim.easing(k),f=e-anim.done,t=anim.total;anim.done=e;
    cam.apply({pan:t.pan&&[t.pan[0]*f,t.pan[1]*f],zoom:(t.zoom||0)*f,bearing:(t.bearing||0)*f,pitch:(t.pitch||0)*f,around:anim.around});
    if(k<1)raf=requestAnimationFrame(frame);else anim=null;
  }
  // 放手：緩衝裡至少兩筆才滑（同 HandlerInertia._onMoveEnd），各項時間取最長的那個。
  function inertia(){
    record();const now=performance.now();while(buffer.length&&now-buffer[0].t>160)buffer.shift();
    const list=buffer;buffer=[];if(list.length<2)return;
    const ms=list[list.length-1].t-list[0].t,pan=[0,0];let zoom=0,bearing=0,pitch=0,around,duration=0;
    for(const {d} of list){pan[0]+=d.pan[0];pan[1]+=d.pan[1];zoom+=d.zoom;bearing+=d.bearing;pitch+=d.pitch;if(d.around)around=d.around;}
    const total={},take=r=>{duration=Math.max(duration,r.duration);return r.amount;},n=len(pan);
    if(n){const a=take(glide(n,ms,PAN));total.pan=[pan[0]*a/n,pan[1]*a/n];}
    if(zoom)total.zoom=take(glide(zoom,ms,ZOOM));
    if(bearing)total.bearing=Math.max(-179,Math.min(179,take(glide(bearing,ms,BEARING))));
    if(pitch)total.pitch=take(glide(pitch,ms,PITCH));
    animate(total,duration,GLIDE,total.zoom||total.bearing?around:undefined);
  }
  function zoomBy(step,point){const [z,lo,hi]=cam.zoomLevel(),d=Math.max(lo,Math.min(hi,z+step))-z;if(d)animate({zoom:d},300,EASE,point);}

  el.addEventListener('contextmenu',e=>e.preventDefault());
  // Windows 放開右鍵才送 contextmenu、目標是游標底下的元素：右鍵（Ctrl＋左鍵）拖曳轉向後在畫布外放開也不跳選單，放開後 500 ms 內都擋。
  const blockMenu=e=>e.preventDefault(),menuOff=()=>{clearTimeout(menuTimer);removeEventListener('contextmenu',blockMenu,true);};
  el.addEventListener('pointerdown',e=>{
    const p=at(e);halt();
    if(e.pointerType==='touch'){
      lastTouch=e.timeStamp;if(!touches.size){forget();panSum=[0,0];}
      touches.set(e.pointerId,p);panFrom.set(e.pointerId,p);
      // 雙指那幾項只看最先放上的兩指，其中一指離開就結束（TwoFingersTouchHandler）；兩指上下疊著不算推仰角。
      if(!two&&touches.size>=2){const [[a,pa],[b,pb]]=touches,v=sub(pa,pb);two={a,b,last:[pa,pb],pitch:vertical(v)?false:undefined,first:undefined,vec:v,from:v,min:len(v),dist:len(v),start:len(v),turn:false,zoom:false};}
      zoomIn.down(e.timeStamp,touches);zoomOut.down(e.timeStamp,touches);
    }else{
      if(mouse)return;
      const pan=e.button===0&&!e.ctrlKey,rotate=e.button===0&&e.ctrlKey||e.button===2&&!e.ctrlKey,pitch=e.button===0&&e.ctrlKey||e.button===2;
      if(!pan&&!rotate&&!pitch)return;
      mouse={id:e.pointerId,button:e.button,last:p,moved:false,pan,rotate,pitch};forget();
      if(rotate||pitch){clearTimeout(menuTimer);addEventListener('contextmenu',blockMenu,true);}
    }
    try{el.setPointerCapture(e.pointerId);}catch{}
    cam.begin?.();
  });
  el.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'){if(touches.has(e.pointerId))touchMove(e);return;}
    if(!mouse||e.pointerId!==mouse.id)return;
    if(!(e.buttons&(mouse.button===2?2:1))){endMouse(false);return;}
    // 移動 3 px 前不算拖（clickTolerance），超過後從按下那點算起。
    const p=at(e),l=mouse.last;if(!mouse.moved&&len(sub(p,l))<3)return;
    mouse.moved=true;mouse.last=p;const d={};
    if(mouse.pan){d.pan=sub(p,l);d.around=p;}
    if(mouse.rotate){const c=centre();d.bearing=Math.abs(c[1]-l[1])>100?angle(sub(p,c),sub([l[0],p[1]],c)):(p[0]-l[0])*.8*(p[1]<c[1]?-1:1);}
    if(mouse.pitch)d.pitch=(p[1]-l[1])*-.5;
    apply(d);
  });
  function touchMove(e){
    const p=at(e);touches.set(e.pointerId,p);zoomIn.move(touches);zoomOut.move(touches);
    if(two){
      const a=touches.get(two.a),b=touches.get(two.b);
      // 兩指一起上下推（TwoFingersTouchPitchHandler）：兩指都動了 2 px 才判斷；只有一指動、過了 100 ms 就不是。
      if(two.pitch===undefined){
        const va=sub(a,two.last[0]),vb=sub(b,two.last[1]),ma=len(va)>=2,mb=len(vb)>=2;
        if(ma&&mb)two.pitch=vertical(va)&&vertical(vb)&&(va[1]>0)===(vb[1]>0);
        else if(ma||mb){two.first??=e.timeStamp;if(e.timeStamp-two.first>=100)two.pitch=false;}
      }
      if(two.pitch){
        // 推仰角時其他雙指手勢整段停用，平移重新起算。
        const va=sub(a,two.last[0]),vb=sub(b,two.last[1]);two.last=[a,b];panFrom.clear();panSum=[0,0];
        apply({pitch:(va[1]+vb[1])/2*-.5});return;
      }
    }
    const d={};
    // 平移：所有手指位移的平均（TouchPanHandler），累計 3 px 才開始；around＝手指的平均位置。
    const was=panFrom.get(e.pointerId);panFrom.set(e.pointerId,p);
    if(was){
      const step=sub(p,was).map(v=>v/panFrom.size);
      if(len(step)){panSum=[panSum[0]+step[0],panSum[1]+step[1]];if(len(panSum)>=3){d.pan=step;d.around=mean(panFrom.values());}}
    }
    if(two){
      const a=touches.get(two.a),b=touches.get(two.b),v=sub(a,b),dist=len(v),lastV=two.vec,lastDist=two.dist;two.vec=v;two.dist=dist;
      // 扭轉：沿兩指圓周轉滿 25 px 才開始；捏合：距離變了 2^0.1 倍才開始。都繞兩指中點。
      if(!two.turn){two.min=Math.min(two.min,dist);two.turn=Math.abs(angle(v,two.from))>=25/(Math.PI*two.min)*360;}
      if(!two.zoom)two.zoom=Math.abs(Math.log2(dist/two.start))>=.1;
      if(two.turn){d.bearing=angle(v,lastV);d.around=mid(a,b);}
      if(two.zoom){d.zoom=Math.log2(dist/lastDist);d.around=mid(a,b);}
    }
    if(d.pan||d.zoom||d.bearing)apply(d);
  }
  function endMouse(glideOn){
    const m=mouse;mouse=null;if(m.moved&&glideOn)inertia();else forget();
    if(m.rotate||m.pitch){clearTimeout(menuTimer);menuTimer=setTimeout(menuOff,500);}
  }
  function touchEnd(e){
    if(!touches.delete(e.pointerId))return;panFrom.delete(e.pointerId);lastTouch=e.timeStamp;
    if(two&&(e.pointerId===two.a||e.pointerId===two.b))two=null;
    if(e.type==='pointercancel'){zoomIn.clear();zoomOut.clear();if(!touches.size)forget();return;}
    const tapIn=zoomIn.up(e.timeStamp,touches),tapOut=zoomOut.up(e.timeStamp,touches);
    if(tapIn)zoomBy(1,tapIn);else if(tapOut)zoomBy(-1,tapOut);else if(!touches.size)inertia();
  }
  const up=e=>{if(e.pointerType==='touch')touchEnd(e);else if(mouse&&e.pointerId===mouse.id)endMouse(e.type!=='pointercancel');};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,up);
  // 觸控之後瀏覽器補發的 dblclick 不算（雙點已經由上面處理）。
  el.addEventListener('dblclick',e=>{e.preventDefault();if(e.timeStamp-lastTouch<1000)return;zoomBy(e.shiftKey?-1:1,at(e));});

  // 滾輪（ScrollZoomHandler）：分得出滑鼠滾輪就照 1/450 的速率、200 ms 平滑到目標；觸控板直接跟著走（1/100）。Shift 減為 1/4。
  const wheel={delta:0,type:null,time:0,value:0,timer:0,target:undefined,from:undefined,easing:null,prev:null,around:null,active:false,finish:0,expected:undefined,frame:0};
  el.addEventListener('wheel',e=>{
    e.preventDefault();
    let v=e.deltaMode===1?40*e.deltaY:e.deltaY;const now=performance.now(),gap=now-wheel.time;wheel.time=now;
    if(v!==0&&v%WHEEL_STEP===0)wheel.type='wheel';
    else if(v!==0&&Math.abs(v)<4)wheel.type='trackpad';
    else if(gap>400){wheel.type=null;wheel.value=v;clearTimeout(wheel.timer);wheel.timer=setTimeout(()=>{wheel.timer=0;wheel.type='wheel';wheel.delta-=wheel.value;if(!wheel.active)wheelStart(e);},40);}
    else if(!wheel.type){wheel.type=Math.abs(gap*v)<200?'trackpad':'wheel';if(wheel.timer){clearTimeout(wheel.timer);wheel.timer=0;v+=wheel.value;}}
    if(e.shiftKey&&v)v/=4;
    if(wheel.type){wheel.delta-=v;if(!wheel.active)wheelStart(e);}
  },{passive:false});
  function wheelStart(e){if(!wheel.delta)return;halt();wheel.active=true;clearTimeout(wheel.finish);wheel.finish=0;wheel.around=at(e);if(!wheel.frame)wheel.frame=requestAnimationFrame(wheelFrame);}
  // 連續滾動接著上一段的速度（_smoothOutEasing）。
  function smoothOut(duration){
    let easing=EASE;const prev=wheel.prev;
    if(prev){const t=(performance.now()-prev.start)/prev.duration,speed=prev.easing(t+.01)-prev.easing(t),x=.27/Math.sqrt(speed*speed+1e-4)*.01;easing=bezier(x,Math.sqrt(Math.max(0,.0729-x*x)),.25,1);}
    wheel.prev={start:performance.now(),duration,easing};return easing;
  }
  function wheelFrame(){
    wheel.frame=0;if(!wheel.active&&!wheel.finish)return;
    const [z,lo,hi]=cam.zoomLevel();
    // 別的手勢在這中間改了縮放，目標跟著位移。
    if(typeof wheel.expected==='number'){const drift=z-wheel.expected;if(typeof wheel.from==='number')wheel.from+=drift;if(typeof wheel.target==='number')wheel.target+=drift;}
    if(wheel.delta){
      const rate=wheel.type==='wheel'&&Math.abs(wheel.delta)>WHEEL_STEP?1/450:1/100;let s=2/(1+Math.exp(-Math.abs(wheel.delta*rate)));if(wheel.delta<0&&s)s=1/s;
      wheel.target=Math.max(lo,Math.min(hi,(typeof wheel.target==='number'?wheel.target:z)+Math.log2(s)));
      if(wheel.type==='wheel'){wheel.from=z;wheel.easing=smoothOut(200);}
      wheel.delta=0;
    }
    const target=typeof wheel.target==='number'?wheel.target:z;let next=target,done=true;
    if(wheel.type==='wheel'&&typeof wheel.from==='number'&&wheel.easing){const k=Math.min((performance.now()-wheel.time+5)/200,1);next=wheel.from+(target-wheel.from)*wheel.easing(k);done=k>=1;}
    if(!done)wheel.frame=requestAnimationFrame(wheelFrame);
    else{wheel.active=false;clearTimeout(wheel.finish);wheel.finish=setTimeout(()=>{wheel.finish=0;wheel.target=wheel.expected=undefined;},200);}
    wheel.expected=next;
    if(next!==z)cam.apply({zoom:next-z,around:wheel.around});
  }
  return{
    halt,
    stop(){halt();forget();menuOff();mouse=two=null;touches.clear();panFrom.clear();zoomIn.clear();zoomOut.clear();
      clearTimeout(wheel.timer);clearTimeout(wheel.finish);cancelAnimationFrame(wheel.frame);Object.assign(wheel,{delta:0,type:null,timer:0,finish:0,frame:0,active:false,target:undefined,from:undefined,expected:undefined});},
  };
}
