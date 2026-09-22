export const routeWidth=zoom=>Math.min(6.5,4.5+Math.max(0,zoom-14)*.4);

export function readableScale(model,p,angle,ratio,zoom,project,mode){
  if(mode==='scale'||zoom>=19)return 1;
  const pixels=(length,a)=>{const dx=Math.cos(a)*length*ratio/2,dy=Math.sin(a)*length*ratio/2,a0=project([p[0]-dx,p[1]-dy,p[2]]),b0=project([p[0]+dx,p[1]+dy,p[2]]);return Math.hypot(a0.x-b0.x,a0.y-b0.y);};
  // 僅 Y 軸加寬，最多兩倍；車長、車距及車高永遠維持公尺比例。
  const target=Math.min(2,Math.max(1,4/Math.max(.5,pixels(model.displayWidthM,angle+Math.PI/2))));
  const t=Math.min(1,Math.max(0,(19-zoom)/2)),fade=t*t*(3-2*t);return 1+(target-1)*fade;
}

export function stationNames(el,map,{project,height,world,getFrame,getObstacles,onStation}){
  const canvas=document.createElement('canvas');canvas.className='ri-station-names';canvas.setAttribute('aria-hidden','true');el.append(canvas);
  const ctx=canvas.getContext('2d');let hits=[],lastCount=0;
  const intersect=(a,b)=>a.x<b.x+b.width+4&&a.x+a.width+4>b.x&&a.y<b.y+b.height+4&&a.y+a.height+4>b.y;
  function draw(){const w=el.clientWidth,h=el.clientHeight,dpr=Math.min(devicePixelRatio,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);hits=[];lastCount=0;const frame=getFrame();if(!frame||map.getZoom()<10.5)return;
    const bounds=map.getBounds(),obstacles=getObstacles(),used=[],names=new Set(),scale=frame.display?.fontScale||1,labelHeight=Math.max(22,22*scale),font=getComputedStyle(document.body).getPropertyValue('--font')||'system-ui';ctx.font=`600 ${13*scale}px ${font}`;ctx.textAlign='left';ctx.textBaseline='middle';
    for(const st of frame.stations){const coord=[st.longitude,st.latitude];if(!bounds.contains(coord))continue;
      const ground=height(coord);if(ground===null)continue;const p=project(world(coord,ground)),key=st.name.replaceAll('臺','台');
      if(p.z< -1||p.z>1||p.x<8||p.x>w-64||p.y<64||p.y>h-110||names.has(key))continue;
      const width=ctx.measureText(st.name).width+12,options=[];
      for(const y of [10,-32,38,-60,66,-88,94,-116,122,-144])for(const x of [8,-width-8])options.push({x:p.x+x,y:p.y+y*scale,width,height:labelHeight});
      const box=options.find(b=>b.x>=8&&b.x+b.width<w-64&&b.y>=64&&b.y+b.height<h-110&&!obstacles.some(o=>intersect(b,o))&&!used.some(o=>intersect(b,o)));
      if(!box)continue;names.add(key);used.push(box);if(used.length>45)break;
      ctx.strokeStyle='#76867a99';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(Math.max(box.x,Math.min(p.x,box.x+box.width)),box.y+box.height/2);ctx.stroke();
      ctx.fillStyle='#fffdf6ed';ctx.beginPath();ctx.roundRect(box.x,box.y,box.width,box.height,4);ctx.fill();ctx.fillStyle='#334b43';ctx.fillText(st.name,box.x+6,box.y+box.height/2);
      hits.push({...box,id:st.id,name:st.name,anchor:{x:p.x,y:p.y},coordinate:coord});lastCount++;
    }
  }
  map.on('render',draw);
  return {get count(){return lastCount;},get boxes(){return hits;},pick(p){const h=hits.find(b=>p.x>=b.x-5&&p.x<=b.x+b.width+5&&p.y>=b.y-11&&p.y<=b.y+b.height+11);if(h){onStation(h.id);return true;}return false;},destroy(){map.off('render',draw);canvas.remove();}};
}

// 與地圖同一個 render 事件投影；牌置中於真實位置，不做移動元素避讓。
export function vehicleMarkers(el,map,{project,world,height,getHits,getFrame,getMarker,getHeading,drawArrow,stats}){
  const canvas=document.createElement('canvas');canvas.className='ri-station-names ri-train-markers';canvas.setAttribute('aria-hidden','true');el.append(canvas);const ctx=canvas.getContext('2d');let boxes=[];
  function draw(){const w=el.clientWidth,h=el.clientHeight,dpr=Math.min(devicePixelRatio,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);boxes=[];stats.vehicleLabels=0;stats.directionArrows=0;const frame=getFrame();if(!frame)return;const zoom=map.getZoom()+1;
    // 跟隨目標畫最後，與原站一致；全台縮到很遠時其餘車沿用原站圓點門檻。
    for(const hit of [...getHits()].sort((a,b)=>Number(a.v.followed)-Number(b.v.followed))){if(hit.modelled)continue;const {v,p}=hit,s=project(p);if(s.z< -1||s.z>1||s.x< -40||s.y< -20||s.x>w+40||s.y>h+20)continue;
      const tag=v.followed||zoom>=(v.systemId.endsWith('_sched')?11:12),glyph=getMarker(v,tag),color=v.color||'#547466';
      if(v.followed){ctx.strokeStyle=color;for(const [radius,alpha,width] of [[17,.3,2],[11,.9,2.5]]){ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.beginPath();ctx.arc(s.x,s.y,radius,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;}
      ctx.drawImage(glyph.canvas,s.x-glyph.width/2,s.y-glyph.height/2,glyph.width,glyph.height);boxes.push({id:v.id,label:String(v.publicLabel||''),tag,x:s.x,y:s.y,width:glyph.width,height:glyph.height,coordinate:[v.longitude,v.latitude]});if(tag)stats.vehicleLabels++;
      if(tag&&frame.display?.dirArrow&&drawArrow){const angle=getHeading(v);if(angle!=null){const coord=[v.longitude+Math.cos(angle)*.00001/Math.cos(v.latitude*Math.PI/180),v.latitude+Math.sin(angle)*.00001],q=world(coord,height(coord)??.65),tip=project(q);drawArrow(ctx,s,Math.atan2(tip.y-s.y,tip.x-s.x),color,(glyph.width-4)/2,(glyph.height-4)/2);stats.directionArrows++;}}
    }
  }
  map.on('render',draw);return {get boxes(){return boxes;},destroy(){map.off('render',draw);canvas.remove();}};
}
