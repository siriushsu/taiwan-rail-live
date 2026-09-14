// 相機角度與跟車置中共用同一張地圖；不移動 DOM pane 或列車座標。
export function cameraMotion(map, {apply, onEnd}) {
  let current=null, frame=0;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cancel(){cancelAnimationFrame(frame);frame=0;if(current){const a=current;current=null;a.resolve(false);}}
  function animate(target,duration=1200){
    cancel();map.stop();
    const from={pitch:map.getPitch(),bearing:map.getBearing()};
    const to={pitch:target.pitch??from.pitch,bearing:from.bearing+(((target.bearing??from.bearing)-from.bearing+540)%360-180)};
    if(target.center){from.center=map.getCenter().toArray();to.center=target.center;}
    for(const key of ['zoom','elevation'])if(target[key]!==undefined){from[key]=key==='zoom'?map.getZoom():map.getCenterElevation();to[key]=target[key];}
    if(target.padding){from.padding=map.getPadding();to.padding=target.padding;}
    let dip=0;
    if(to.center&&to.zoom!==undefined){const meters=Math.hypot((to.center[0]-from.center[0])*111320*Math.cos(to.center[1]*Math.PI/180),(to.center[1]-from.center[1])*111320);const travelZoom=Math.log2(40075016.686*Math.cos(to.center[1]*Math.PI/180)*map.getContainer().clientWidth/(512*Math.max(100,meters)*1.4));dip=Math.max(0,(from.zoom+to.zoom)/2-Math.max(6,travelZoom));}
    return new Promise(resolve=>{
      const a=current={from,to,resolve,start:performance.now(),duration:reduced()?0:duration};
      function step(now){
        if(current!==a)return;
        const t=a.duration?Math.min(1,(now-a.start)/a.duration):1,e=t*t*(3-2*t);
        const pose={pitch:from.pitch+(to.pitch-from.pitch)*e,bearing:from.bearing+(to.bearing-from.bearing)*e};
        if(to.center)pose.center=from.center.map((v,i)=>v+(to.center[i]-v)*e);
        for(const key of ['zoom','elevation'])if(to[key]!==undefined)pose[key]=from[key]+(to[key]-from[key])*e;
        if(to.zoom!==undefined)pose.zoom-=dip*Math.sin(Math.PI*t)**2;
        if(to.padding)pose.padding=Object.fromEntries(Object.keys(to.padding).map(k=>[k,from.padding[k]+(to.padding[k]-from.padding[k])*e]));
        apply(pose);
        if(t<1)frame=requestAnimationFrame(step);
        else{frame=0;map.once('render',()=>{if(current!==a)return;current=null;onEnd();resolve(true);});map.triggerRepaint();}
      }
      frame=requestAnimationFrame(step);
    });
  }
  return {animate,cancel,get active(){return !!current;},get positioning(){return !!current?.to.center;}};
}
