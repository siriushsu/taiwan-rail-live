/* 與主站共用 MapLibre、行車時鐘及點擊/跟隨；只接入 3D 顯示。 */
(async()=>{
  const base='./rail-3d/integration/';
  const {formationFor,airportServiceForTrip,tripDirection,stationDirection}=await import(base+'formations.js');
  const directionCache=new WeakMap();function timetableDirection(tr,ln){if(!directionCache.has(tr))directionCache.set(tr,tripDirection(tr,ln.stations.length,!!ln.loop));return directionCache.get(tr);}
  const serviceCache=new WeakMap();function airportService(tr){if(!serviceCache.has(tr))serviceCache.set(tr,airportServiceForTrip(tr));return serviceCache.get(tr);}
  const params=new URLSearchParams(location.search),read=(key,fallback)=>{try{return sessionStorage.getItem(key)||fallback;}catch{return fallback;}};
  let enabled=params.get('scene')!=='2d'&&read('ri-trains-enabled','1')!=='0',formationMode=params.get('formation')||read('ri-formation-mode','actual'),
    groundMode=params.get('ground')||read('ri-ground-mode','flat'),trainSizeMode=params.get('trainSize')||read('ri-train-size-v21','readable'),
    modelMode=read('ri-model-mode','all'),ambientCamera=read('ri-ambient-camera','side'),transparent=read('ri-transparent','1')==='1';
  formationMode=formationMode==='three'?'three':'actual';groundMode=groundMode==='terrain'?'terrain':'flat';trainSizeMode=trainSizeMode==='scale'?'scale':'readable';
  let renderer=null,lastFrame=null,loading=false,loadSerial=Promise.resolve(),epoch=0,manualTarget=null,appearanceKey='',noteAt=0;
  const shapeCache=new WeakMap(),tripKeys=new WeakMap(),targets=new Map(),stationTargets=new Map(),motionItems=new Map(),headings=new Map(),errors=[];
  const save=(key,value)=>{try{sessionStorage.setItem(key,String(value));}catch{}};
  function tripKey(tr){
    if(!tripKeys.has(tr)){let h=2166136261;for(const c of JSON.stringify(tr)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}tripKeys.set(tr,(h>>>0).toString(36));}return tripKeys.get(tr);
  }
  function coreRouteDirection(tr,ln){const ps=tr?.trajectory?.map(p=>p.progress).filter(Number.isFinite)||[],next=ps.find(p=>Math.abs(p-ps[0])>1e-6);return stationDirection(ps[0],next??tr?.nextCall?.stationIndex??ps[0],ln.stations.length,!!ln.loop);}
  function lineRecord(ln,systemId){
    const shape=ln.shape;
    let coordinates=shapeCache.get(shape||ln);
    if(!coordinates){coordinates=shape?shape.map(c=>[c[1],c[0]]):(ln.stations||[]).map(s=>[s.lon,s.lat]);shapeCache.set(shape||ln,coordinates);}
    return {id:systemId+':'+ln.id,systemId,routeId:String(ln.id),lineKey:(ln._sys||ln.sys||systemId)+'|'+ln.id,color:ln.color||'#547466',coordinates,loop:!!ln.loop};
  }
  function capture(){
    const epoch=Date.now()/1000,day=taipeiServiceDayStr(),vehicles=[],routes=[],stations=[];
    targets.clear();stationTargets.clear();motionItems.clear();
    function add(id,pos,meta,target){if(!pos||!Number.isFinite(pos.lat)||!Number.isFinite(pos.lon))return;
      targets.set(id,target);vehicles.push({id,longitude:pos.lon,latitude:pos.lat,railElevationM:null,...meta});}
    function station(st,sys,ln){const board=ln?{name:st.name,lat:st.lat,lon:st.lon,sys:state.mode==='sched'?'deco':'freq',metroSysId:sys}:st;
      const id=[sys,st.id||st.name,st.lat,st.lon].join(':');if(stationTargets.has(id))return;stationTargets.set(id,board);stations.push({id,name:st.name,systemId:sys,longitude:st.lon,latitude:st.lat});}
    const pools=state.mode==='sched'?(state.deco?state.decoLines||[]:[]):state.lines||[];
    if(state.mode==='sched'){
      for(const ln of state.trackLines||[])if(!state.trackVisible||state.trackVisible.has(ln.id))routes.push(lineRecord(ln,ln.sys||ln._sys||'rail'));
      for(const st of state.schedStations||[])station(st,st.sys);
      if(!state.collectMap)for(const tr of state.trains){
        if(tr!==state.followTrain&&!state.visible.has(tr.typeName))continue;
        const pos=trainPos(tr,state.simSec);if(!pos)continue;
        const g=trainSeg(tr,state.simSec-liveDelaySec(tr)-blockHoldSec(tr));
        const route=g?.ln?lineRecord(g.ln,tr.sys):null;
        const id=[tr.sys,day,tr.train,tr.stops[0]?.depSec,tr.stops.at(-1)?.arrSec].join(':');
        add(id,pos,{systemId:tr.sys,routeId:route?.routeId||null,route,color:tr.color||'#438477',publicLabel:String(tr.train),typeName:tr.typeName,carName:tr.carName,stockId:specialOf(tr)?.stock?.id||null,branchId:specialOf(tr)?.branch?.id||null,namedId:specialOf(tr)?.named?.id||null,chainageM:Number.isFinite(g?.d)?g.d*1000:null,
          sourceKind:'timetable',direction:g?.dir??null,followed:state.followTrain===tr},{tr});
      }
    }
    for(const ln of pools){
      if(state.mode!=='sched'&&!state.visible.has(ln.id))continue;
      const sys=freqSysIdOf(ln),route=lineRecord(ln,sys),common={systemId:sys,routeId:String(ln.id),route,color:ln.color,publicLabel:ln.abbr||ln.name};
      routes.push(route);for(const st of ln.stations||[])station(st,sys,ln);
      if(state.collectMap)continue;
      const core=metroCoreItemsForLine(ln,epoch),official=core===null?trtcOfficialItemsForLine(ln,epoch):null;
      if(core!==null||official!==null){
        for(const item of core??official){const kind=core!==null?'core':'official',f=state.freqFollow;
          const followed=!!f&&!!f.core===(kind==='core')&&String(f.lineId)===String(ln.id)&&String(f.vehicleId)===String(item.vehicleId)&&(!f.core||String(f.systemId)===String(item.systemId));
          const id=[sys,ln.id,kind,item.vehicleId].join(':');motionItems.set(id,item);
          add(id,item.pos,{...common,sourceKind:kind,publicLabel:item.publicLabel||item.officialNo||ln.abbr,direction:item.train?.direction??item.vehicle?.direction??null,railDirection:coreRouteDirection(item.train,ln),followed},
            {ln,vehicleId:item.vehicleId,core:kind==='core',systemId:item.systemId});
        }continue;
      }
      if(ln._tt){for(const tr of ln._tt){const f=state.freqFollow;
        add([sys,ln.id,ln._ttServiceDay||day,'tt',tripKey(tr)].join(':'),freqTrainPosAt(ln,tr,state.simSec),{...common,airportService:sys==='tymc'?airportService(tr):null,sourceKind:'timetable',direction:Math.sign(tr.at(-2)-tr[0]),railDirection:timetableDirection(tr,ln),followed:!!f&&f.ln===ln&&f.tr===tr},{ln,tr});}
      }else if(ln.sched)for(let k=0;k<ln.n;k++){const tau=(state.mode==='sched'?state.decoElapsed:state.elapsed)*state.speedMult+k*ln.period/ln.n,f=state.freqFollow;
        add([sys,ln.id,day,'frequency',k].join(':'),posPeriodic(ln,tau),{...common,sourceKind:'frequency',direction:null,followed:!!f&&f.ln===ln&&f.k===k},{ln,k});}
    }
    for(const id of headings.keys())if(!targets.has(id))headings.delete(id);
    return {clock:{serviceDay:day,simSec:state.simSec,wallEpochSec:epoch,playing:state.playing,speed:state.speedMult},geometryVersion:'original-'+BUILD,
      clearanceRoutes:[...new Set([...(state.trackLines||[]),...(state.lines||[]),...(state.decoLines||[])])].map(ln=>lineRecord(ln,ln.sys||ln._sys||'rail')),
      visible:[...state.visible],vehicles,routes:(state.collectMap||state.trackStyle==='hidden'?[]:routes).map(r=>({...r,displayColor:r.systemId.endsWith('_sched')||r.systemId==='rail'?trackLineColor(r.color):metroLineColor(r.color)})),stations,
      display:{enabled,modelMode,formationMode,ambient:!!state.ambient,ambientStyle:state.ambientStyle,ambientCamera,northUp:!!state._northReset||state._northUpTarget===(state.followTrain||state.freqFollow),dark:state.mapDark,dirArrow:!!state.dirArrow,fontScale:Number(getComputedStyle(document.body).getPropertyValue('--ui'))||1},
      followLock:state.followLock,selectedVehicleId:vehicles.find(v=>v.followed)?.id||null};
  }
  function headingFor(v){const hit=targets.get(v.id),item=motionItems.get(v.id);if(!hit)return null;let previous;
    if(!hit.ln)previous=trainPos(hit.tr,state.simSec-DIR_DT_SEC);
    else if(item)previous=hit.core?metroCorePositionAt(hit.ln,item.train,Date.now()/1000-DIR_DT_SEC):trtcOfficialDirectionPrevious(hit.ln,item.vehicle,item.pos);
    else if(hit.tr)previous=freqTrainPosAt(hit.ln,hit.tr,state.simSec-DIR_DT_SEC);
    else{const ln=hit.ln,tau=(state.mode==='sched'?state.decoElapsed:state.elapsed)*state.speedMult+hit.k*ln.period/ln.n;previous=posPeriodic(ln,tau-DIR_DT_SEC);}
    if(previous){const dx=(v.longitude-previous.lon)*Math.cos(v.latitude*Math.PI/180),dy=v.latitude-previous.lat;if(Math.hypot(dx,dy)>1e-6)headings.set(v.id,Math.atan2(dy,dx));}
    return headings.get(v.id)??null;
  }

  function sameTarget(a,b){return !!a&&!!b&&(a.ln?b.ln===a.ln&&(a.tr?a.tr===b.tr:a.vehicleId!=null?String(a.vehicleId)===String(b.vehicleId)&&!!a.core===!!b.core:a.k===b.k):a.tr===b.tr&&!b.ln);}
  function currentTarget(){return state.followTrain?{tr:state.followTrain}:state.freqFollow;}
  function idFor(target){for(const [id,hit]of targets)if(sameTarget(target,hit))return id;return null;}
  function select(id){const hit=targets.get(id);if(!hit)return false;manualTarget=null;if(hit.ln)setFreqFollow(hit);else setFollow(hit.tr,false,true);return true;}
  function updateNote(){if(performance.now()-noteAt<300)return;noteAt=performance.now();const v=lastFrame?.vehicles.find(v=>v.followed),spec=v&&formationFor(v,formationMode);
    for(const panel of [document.getElementById('followPanel'),document.getElementById('freqCard')]){if(!panel)continue;let el=panel.querySelector('.ri-formation-caption');if(!el){el=document.createElement('div');el.className='ri-formation-caption';panel.append(el);}const text=spec?(spec.mode==='three'?t('3 節示意'):spec.countBasis==='unknown'?t('3 節示意 · 當班編組待確認'):t(spec.articulated?'{n} 分節 · 標準編組':'{n} 節 · 標準編組',{n:spec.actualCarCount})):'';el.hidden=!enabled||!spec;el.textContent=text?text+(groundMode==='terrain'?' · '+t('地表起伏示意'):''):'';}
  }
  function syncAppearance(){if(!renderer)return;const key=[state.map3d,state.mapDark,transparent].join(':');if(key===appearanceKey)return;appearanceKey=key;renderer.setAppearance({buildings:state.map3d,dark:state.mapDark,transparent});}
  function render(){if(!renderer||!M.raw.getLayer('live-vehicles-3d')||!state.ready||document.hidden)return;try{
    if(M.raw.getZoom()<13.8){if(lastFrame?.vehicles.length){lastFrame={...lastFrame,vehicles:[],selectedVehicleId:null};renderer.update(lastFrame);}return;}
    lastFrame=capture();renderer.update(lastFrame);syncAppearance();updateNote();
  }catch(e){if(errors.length<5){errors.push(String(e.stack||e));console.error('3D 顯示',e);}enabled=false;syncUI();}}
  function recenter(lat,lon,extra){if(!renderer||!M.raw.getLayer('live-vehicles-3d')||!enabled||M.raw.getZoom()<14||!lastFrame?.selectedVehicleId||renderer.interacting)return false;
    // 完整編組自己沿軌預留車頭空間，不再疊加平面模式的像素前瞻。
    const padding={...mapInsets()};for(const key of ['top','bottom','left','right'])padding[key]=Math.max(0,Number(padding[key])||0);
    state._autoPan=true;try{renderer.followCoordinate([lon,lat],padding);}finally{state._autoPan=false;}return true;
  }
  function attach(){const ticket=++epoch;loadSerial=loadSerial.catch(()=>{}).then(async()=>{if(ticket!==epoch)return;loading=true;syncUI();renderer?.destroy();renderer=null;appearanceKey='';
    try{const {createLiveMap}=await import(base+'map3d.js');if(ticket!==epoch)return;
      const next=await createLiveMap({map:M.raw,isCurrent:()=>ticket===epoch&&M.isStyleReady(),groundMode,formationMode,trainSizeMode,getHeading:headingFor,onGesture:()=>setFollowLock(false),onInteract:()=>{state._gestureAt=state._interactAt=performance.now();},onError:e=>{if(errors.length<20)errors.push(e);}});
      if(ticket!==epoch){next.destroy();return;}renderer=next;syncAppearance();render();
    }catch(e){if(e.name!=='AbortError'){errors.push(String(e.stack||e));showToast(t('立體顯示載入失敗，請重試'));}}finally{loading=false;syncUI();}});}
  const labels={enabled:['立體列車','開啟','關閉'],formation:['列車編組','完整編組','三節示意'],ground:['地形','平坦','起伏試驗'],size:['列車大小','容易辨認','原始比例'],models:['顯示列車','全部近景','只看選取'],inspection:['建築透視','透明','一般'],camera:['賞車視角','側拍','環繞']};
  function syncUI(){for(const row of document.querySelectorAll('[data-rail3d]')){const key=row.dataset.rail3d,value={enabled:enabled?'on':'off',formation:formationMode,ground:groundMode,size:trainSizeMode,models:modelMode,inspection:transparent?'on':'off',camera:ambientCamera}[key];for(const b of row.querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.value===value));b.classList.toggle('on',b.dataset.value===value);b.disabled=loading;}}}
  function setOption(key,value){switch(key){case 'enabled':enabled=value==='on';save('ri-trains-enabled',enabled?'1':'0');break;
    case 'formation':formationMode=value==='three'?'three':'actual';save('ri-formation-mode',formationMode);renderer?.setFormationMode(formationMode);break;
    case 'ground':groundMode=value==='terrain'?'terrain':'flat';save('ri-ground-mode',groundMode);renderer?.setGroundMode(groundMode);glTracks.sig='';M.raw.getLayer('building-glass-edges')?.implementation?.schedule();break;
    case 'size':trainSizeMode=value==='scale'?'scale':'readable';save('ri-train-size-v21',trainSizeMode);renderer?.setTrainSizeMode(trainSizeMode);break;
    case 'models':modelMode=value==='selected'?'selected':'all';save('ri-model-mode',modelMode);break;
    case 'inspection':transparent=value==='on';save('ri-transparent',transparent?'1':'0');break;
    case 'camera':ambientCamera=value==='orbit'?'orbit':'side';save('ri-ambient-camera',ambientCamera);break;}
    if(enabled&&!renderer&&!loading&&M.isStyleReady())attach();
    syncAppearance();syncUI();render();M.raw.triggerRepaint();}
  function setup(){const host=document.getElementById('map3dRow');if(!host||!M?.raw)return;
    const group=document.createElement('div');group.className='ri-3d-settings';
    const values={enabled:['on','off'],formation:['actual','three'],ground:['flat','terrain'],size:['readable','scale'],models:['all','selected'],inspection:['on','off'],camera:['side','orbit']};
    for(const [key,[label,...options]]of Object.entries(labels)){const row=document.createElement('div');row.className='ms-row ri-3d-row';row.dataset.rail3d=key;const name=document.createElement('span');name.className='nm';name.textContent=t(label);row.append(name);const seg=document.createElement('div');seg.className='seg';seg.setAttribute('role','group');seg.setAttribute('aria-label',t(label));options.forEach((text,i)=>{const b=document.createElement('button');b.type='button';b.dataset.value=values[key][i];b.textContent=t(text);b.onclick=e=>{e.stopPropagation();setOption(key,b.dataset.value);};seg.append(b);});row.append(seg);group.append(row);}
    const help=document.createElement('p');help.className='ri-3d-help';help.textContent=t('放大地圖即可看見立體列車。完整編組依車型或路線標準；缺少當班資料時顯示三節示意。起伏為地表顯示，非實測軌道高程。');group.append(help);host.after(group);
    M.raw.on('style.load',attach);M.raw.on('rotatestart',e=>{if(e.originalEvent)manualTarget=currentTarget();});M.raw.on('pitchstart',e=>{if(e.originalEvent)manualTarget=currentTarget();});
    if(params.get('scene')==='3d'){setMap3d(true);M.setPitch(55);const zoom=Number(params.get('z'));if(Number.isFinite(zoom)&&zoom>=14&&zoom<=21){M.stop();M.raw.setZoom(zoom-ML_Z);}}if(M.isStyleReady())attach();syncUI();
  }
  window.railIslandIntegration={version:24,beforeStyleChange(){epoch++;renderer?.destroy();renderer=null;appearanceKey='';},get active(){return !!renderer&&enabled&&!!M.raw.getLayer('live-vehicles-3d');},get renderer(){return renderer;},get loading(){return loading;},errors,capture,render,recenter,select,
    get frame(){return lastFrame;},
    get formationMode(){return formationMode;},get groundMode(){return groundMode;},get interacting(){return renderer?.interacting||false;},
    frontScreen(){return enabled&&renderer?.frontScreen();},
    resetManualHeading(){manualTarget=null;},
    keepBearing(){return enabled&&M?.raw?.getZoom()>=14&&(sameTarget(manualTarget,currentTarget())||state.ambient&&state.ambientStyle==='follow');},
    hasModel(target){const id=idFor(target);return enabled&&id&&!!M.raw.getLayer('live-vehicles-3d')&&renderer?.hasModel(id);},
    hits(point,freq){if(!enabled||!M.raw.getLayer('live-vehicles-3d'))return [];return renderer?.hitTest(point).map(hit=>({...targets.get(hit.id),dist:hit.dist,boxed:true})).filter(hit=>!!hit.ln===freq)||[];},
    profileKeys(){return renderer?.profileKeys()||[];},setMode:value=>setOption('enabled',value?'on':'off'),setGroundMode:value=>setOption('ground',value),setFormationMode:value=>setOption('formation',value),setTrainSize:value=>setOption('size',value),setModelMode:value=>setOption('models',value),setAmbientCamera:value=>setOption('camera',value),setInspection:value=>setOption('inspection',value?'on':'off'),syncAppearance,
    shareParams(url){if(!enabled)url.searchParams.set('scene','2d');if(groundMode==='terrain')url.searchParams.set('ground','terrain');if(formationMode==='three')url.searchParams.set('formation','three');return url;}};
  if(state.ready)setup();else{const timer=setInterval(()=>{if(state.ready){clearInterval(timer);setup();}},100);}
})().catch(error=>console.error('3D 接點',error));
