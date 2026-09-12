import {buildingCatalog,buildBlenderBuilding,inspectBlenderBuilding} from './blender-buildings.js';
import * as THREE from './vendor/three.module.js';
import {disposeStation} from './station-models.js';
import {landmarkCatalog} from './landmark-catalog.js';
import {stationCatalog} from './station-catalog.js';
import {inPolygon,distanceToSegment} from './geo.js';

export async function createStationLayer(map,getState,onUpdate=()=>{}, {assetsBase=new URL('./assets/stations/',import.meta.url),maplibre=globalThis.maplibregl,clearance=null}={}){
  const failures=[],records=[],catalog=[...stationCatalog,...landmarkCatalog];
  const imports=await buildingCatalog();
  for(const imported of imports){
    const {meta,footprint}=imported,entry=catalog.find(e=>e.id===meta.id)||{id:meta.id,key:meta.id,name:meta.name};
    const features=footprint.type==='FeatureCollection'?footprint.features:[footprint],masks=features.map(f=>f.geometry.coordinates);
    const maskBounds=masks.map(r=>{const xs=r[0].map(p=>p[0]),ys=r[0].map(p=>p[1]);return [Math.min(...xs)-.00002,Math.min(...ys)-.00002,Math.max(...xs)+.00002,Math.max(...ys)+.00002];});
    const anchor=maplibre.MercatorCoordinate.fromLngLat(meta.anchor,0),s=anchor.meterInMercatorCoordinateUnits(),transform=new THREE.Matrix4().makeTranslation(anchor.x,anchor.y,0).scale(new THREE.Vector3(s,-s,s));
    const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,1.65));const sun=new THREE.DirectionalLight(0xfff3db,1.8);sun.position.set(-160,-260,500);scene.add(sun);
    records.push({entry,meta,footprint,masks,maskBounds,scene,transform,imported,model:null,lastUsed:0,loading:null,retryAt:new Map(),
      stats:{id:meta.id,blender:true,ready:false,visible:false,inspection:false,groundM:null,displayHeightM:meta.displayHeightM,railElevationM:null,realBuildingHeightM:meta.realBuildingHeightM||null,meshes:0,triangles:0,masked:false,excludedFeatureIds:[],revision:0}});
  }
  records.sort((a,b)=>catalog.findIndex(e=>e.id===a.meta.id)-catalog.findIndex(e=>e.id===b.meta.id));
  const camera=new THREE.Camera(),projection=new THREE.Matrix4(),filters=new Map(),symbolFilters=new Map(),appliedSymbols=new Map();
  let renderer,ownedSource,disposed=false,timer=0,viewTimer=0,sourceEpoch=0,maskEpoch=-1,maskKey='',contextKey='',labelKey='',lastVisible='',clock=0,engineeringMasks=[],engineeringMaskKey='',labelBounds=[];
  function primary(){return records.find(r=>r.entry.key===getState().place)||records.find(r=>r.stats.visible)||records[0];}
  function expandedBox(r,padding){const points=r.masks.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),dx=padding/(111320*Math.cos(r.meta.anchor[1]*Math.PI/180)),dy=padding/111320;return [Math.min(...xs)-dx,Math.min(...ys)-dy,Math.max(...xs)+dx,Math.max(...ys)+dy];}
  function rectangle([w,s,e,n]){return [[[w,s],[e,s],[e,n],[w,n],[w,s]]];}
  // 每一棟建物(feature)的判定結果依「圖磚:id」快取:分件歸屬哪座站房、是否壓到行車走廊都是靜態幾何,
  // 圖磚還在就不必再解碼、再跑 owner()/blocked(),remainders 的 Feature 物件也直接留用。
  // 2026-09-08 桌面 6x 降速實測:一次重算 620ms,其中 blocked() 190ms、把一萬多個分件座標
  // JSON.stringify 兩遍 135ms、解碼 110ms;圖磚集合沒變時這些全是重複工。
  // 快取在路線集合(clearance.revision)或工程遮罩改變時整批作廢,圖磚卸載時逐條淘汰。
  const partCache=new Map();let partCacheKey='';
  // 只在新分件進快取時序列化一次；沿用原版的完整多邊形相等規則，不以短雜湊代替。
  function polygonHash(rings){return JSON.stringify(rings);}
  function maskBuildings(active){
    const visibleKey=active.map(r=>r.meta.id).join(',')+':'+(clearance?.revision||0);if(maskEpoch===sourceEpoch&&visibleKey===lastVisible)return false;
    maskEpoch=sourceEpoch;lastVisible=visibleKey;
    const cacheKey=(clearance?.revision||0)+':'+engineeringMaskKey;if(cacheKey!==partCacheKey){partCacheKey=cacheKey;partCache.clear();}
    const ids=new Set(),activeSet=new Set(active),candidates=[...records,...engineeringMasks];for(const r of candidates){r.stats.masked=r.stats.visible;r.stats.excludedFeatureIds=[];}
    const polygons=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    // 凹輪廓不能用中心放大當緩衝（凹角會把自己的頂點排除）。只容許 1.5m
    // 邊界量化差，並先以 bbox 淘汰遠處建物。歸屬對全部站房算(不只可見的),結果才能跨次重用。
    const owners=p=>candidates.filter(r=>p[0].every(q=>r.masks.some((mask,i)=>{const [w,s,e,n]=r.maskBounds[i];return q[0]>=w&&q[0]<=e&&q[1]>=s&&q[1]<=n&&(inPolygon(q[0],q[1],mask)||mask.some(ring=>ring.slice(1).some((b,k)=>distanceToSegment(q[0],q[1],ring[k],b)<1.5/111320)));})));
    const features=map.getSource('openmaptiles')&&(active.length||clearance)?map.querySourceFeatures('openmaptiles',{sourceLayer:'building'}):[];
    // 圖磚會把站房和遠處建物合併成同一 MultiPolygon；拆出站房後，把其餘
    // 分件原位重畫，不能讓背景建物消失，也不能保留一個方塊蓋住新屋頂。
    const live=new Set(),remainders=[],entries=[],hit=x=>x.blocked||x.owners.some(r=>activeSet.has(r));
    for(const f of features){if(f.id===undefined)continue;const key=f.tile.z+'/'+f.tile.x+'/'+f.tile.y+':'+f.id;live.add(key);
      let parts=partCache.get(key);
      // 圖磚緩衝區會讓同一分件在相鄰圖磚各出現一次(座標逐 byte 相同),sig 對整個多邊形雜湊,remainders 只畫一份。
      if(!parts){parts=polygons(f).map((p,i)=>({owners:owners(p),blocked:!!clearance?.blocked(p),key:key+':'+i,sig:f.id+':'+polygonHash(p),feature:{type:'Feature',properties:{...f.properties,station_original_id:f.id},geometry:{type:'Polygon',coordinates:p}}}));partCache.set(key,parts);}
      entries.push([f.id,parts]);
      for(const x of parts)if(hit(x)){ids.add(f.id);const r=x.owners.find(r=>activeSet.has(r));if(r&&!r.stats.excludedFeatureIds.includes(f.id))r.stats.excludedFeatureIds.push(f.id);}
    }
    // 同一個 id 在相鄰圖磚的另一份可能剛好沒有被遮到的分件,但整個 id 已從 building-3d 排除,它的分件也要重畫。
    for(const [id,parts] of entries)if(ids.has(id))for(const x of parts)if(!hit(x))remainders.push(x);
    for(const key of partCache.keys())if(!live.has(key))partCache.delete(key);
    remainders.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);const sigs=new Set(),unique=remainders.filter(x=>!sigs.has(x.sig)&&sigs.add(x.sig)),nextContext=unique.map(x=>x.key).join('|');let changed=false;
    if(nextContext!==contextKey){contextKey=nextContext;ownedSource.setData({type:'FeatureCollection',features:unique.map(x=>x.feature)});changed=true;}
    const values=[...ids].sort((a,b)=>a-b),key=values.join(',');if(key!==maskKey){maskKey=key;for(const [id,original] of filters){const exclude=['!', ['in',['id'],['literal',values]]];map.setFilter(id,values.length?(original?['all',original,exclude]:exclude):original);}changed=true;}return changed;
  }
  function maskLabels(active){
    // 預留字幅及傾斜屋頂的投影範圍；透視仍不讓地名穿入站房，實體招牌保留。
    const boxes=active.map(r=>expandedBox(r,100+Math.min(450,r.meta.displayHeightM*Math.tan(map.getPitch()*Math.PI/180))));
    const key=JSON.stringify([boxes,sourceEpoch]);if(key===labelKey)return false;labelKey=key;
    const geometry={type:'MultiPolygon',coordinates:boxes.map(rectangle)},lineNames=new Map();
    // 長道路線不一定整條 within 站區，另依相交線段移除名稱。
    for(const {sourceLayer} of symbolFilters.values())if(sourceLayer&&!lineNames.has(sourceLayer)){
      const names=new Set();if(boxes.length)for(const f of map.querySourceFeatures('openmaptiles',{sourceLayer})){
        const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
        if(lines.some(line=>line.some((p,i)=>{const q=line[i+1]||p;return boxes.some(([w,s,e,n])=>Math.min(p[0],q[0])<=e&&Math.max(p[0],q[0])>=w&&Math.min(p[1],q[1])<=n&&Math.max(p[1],q[1])>=s)})))for(const field of ['name','name:zh','name:zh-Hant'])if(f.properties[field])names.add(f.properties[field]);
      }lineNames.set(sourceLayer,[...names].sort());
    }
    let changed=false;const apply=(id,value)=>{const key=JSON.stringify(value);if(appliedSymbols.get(id)===key)return;appliedSymbols.set(id,key);map.setFilter(id,value);changed=true;};
    for(const [id,{original,sourceLayer}] of symbolFilters){
      if(!boxes.length){apply(id,original);continue;}
      const clauses=[['!', ['within',geometry]]],names=lineNames.get(sourceLayer)||[];
      if(names.length)for(const field of ['name','name:zh','name:zh-Hant'])clauses.push(['!', ['in',['coalesce',['get',field],''],['literal',names]]]);
      apply(id,['all',...(original?[original]:[]),...clauses]);
    }return changed;
  }
  function refresh(){
    if(disposed||!ownedSource||map.getSource('station-building-remainders')!==ownedSource)return;const state=getState(),c=map.getCenter();let changed=false;
    for(const r of records){
      const near=Math.hypot((c.lng-r.meta.anchor[0])*101000,(c.lat-r.meta.anchor[1])*111320)<3500;
      const resolved=clearance?.model(r.meta,r.footprint),key=JSON.stringify(resolved?.excluded||[]);
      if(r.clearanceKey!==key){r.clearanceKey=key;r.appearanceKey=null;r.stats.excludedComponents=resolved?.excluded||[];r.stats.clearanceHidden=false;maskEpoch=-1;changed=true;}
      const inRange=state.buildings&&map.getZoom()>=14&&near;
      // 只等建物所在位置的地形；遠處圖磚未完成不應隱藏已可定位的模型。
      const ground=inRange?(state.terrain?map.queryTerrainElevation(r.meta.anchor):0):null;
      const canShow=inRange&&Number.isFinite(ground),lod=map.getZoom()>=16?'near':'far';
      if(canShow&&r.model?.userData.lod!==lod&&r.loading?.lod!==lod&&performance.now()>=(r.retryAt.get(lod)||0)){
        const ticket={lod};r.loading=ticket;
        buildBlenderBuilding(r.imported,lod).then(model=>{
          if(disposed||r.loading!==ticket){disposeStation(model);return;}
          if(r.model){r.scene.remove(r.model);disposeStation(r.model);}r.model=model;r.scene.add(model);r.loading=null;r.appearanceKey=null;r.stats.groundM=null;
          r.labelBox=new THREE.Box3().setFromObject(model);r.stats.meshes=0;r.stats.triangles=0;model.traverse(o=>{if(o.isMesh){r.stats.meshes++;r.stats.triangles+=o.geometry.drawRange.count/3;}});r.stats.ready=true;r.stats.lod=lod;delete r.stats.loadError;r.retryAt.delete(lod);for(let i=failures.length-1;i>=0;i--)if(failures[i].key===r.entry.key)failures.splice(i,1);maskEpoch=-1;refresh();
        }).catch(error=>{if(disposed||r.loading!==ticket)return;r.loading=null;r.retryAt.set(lod,performance.now()+30000);r.stats.loadError=error.message;if(!failures.some(f=>f.key===r.entry.key))failures.push({key:r.entry.key,message:error.message});onUpdate(r.stats);});
      }
      const visible=canShow&&!!r.model;r.maskActive=visible;let revision=r.stats.visible!==visible;
      if(r.model){r.model.visible=visible;if(visible){r.lastUsed=++clock;if(r.stats.groundM!==ground){r.model.position.z=ground;r.stats.groundM=ground;revision=true;}
        // 複合園區逐棟貼地；相連的月台與棚架可共用地面錨點，避免棚柱懸空。
        if(r.meta.calibration){
          const heights=new Map(r.meta.calibration.parts.map(p=>[p.id,state.terrain?map.queryTerrainElevation(p.terrainAnchor||p.anchor):(p.flatGroundOffsetM??0)]));
          r.model.traverse(mesh=>{if(!mesh.isMesh)return;const h=heights.get(mesh.userData.component);const ready=Number.isFinite(h);if(mesh.visible!==ready){mesh.visible=ready;revision=true;}if(ready&&mesh.position.z!==h-ground){mesh.position.z=h-ground;revision=true;}});
        }
        const inspect=!!state.stationInspection&&(state.stationInspectionAll||r.entry.key===state.place),appearance=JSON.stringify([inspect,r.stats.excludedComponents,!!state.stationSolidAppearance]);
        if(r.appearanceKey!==appearance){inspectBlenderBuilding(r.model,inspect,r.stats.excludedComponents,!!state.stationSolidAppearance);r.appearanceKey=appearance;r.stats.inspection=inspect;revision=true;}
      }}
      r.stats.visible=visible;if(revision){r.stats.revision++;changed=true;}
    }
    // 環島巡覽只保留最近三座的 GPU 幾何。
    const cached=records.filter(r=>r.model).sort((a,b)=>b.lastUsed-a.lastUsed);for(const r of cached.slice(3))if(!r.stats.visible){r.scene.remove(r.model);disposeStation(r.model);r.model=null;r.stats.ready=false;r.stats.inspection=false;}
    if(changed){onUpdate(primary()?.stats);map.triggerRepaint();}
    scheduleMasks();
  }
  // 建物遮罩延後到「相機真的停下來」再算。maskBuildings 把所有已載入圖磚的建物解碼出來,逐棟做
  // owner() 與 clearance.blocked();maskLabels 則對每一個 symbol 圖層 setFilter,而 filter 一變
  // MapLibre 就要重跑整批圖磚的符號排版。平移時每張新圖磚都讓 sourceEpoch++,於是這兩件事每幾秒
  // 就重來一次,每次都是一個明顯的停頓。
  // 前期桌面 6x 降速排查(台北車站、拖曳 25 秒、建築 3D 開):整層移除後 >150ms 的幀
  // 由 9-15 個變成 0、p99 由 433-488ms 降到 99-103ms，指向此層的重算尖峰。
  // 判準用「距上次相機移動多久」而不是 map.isMoving():手指離開螢幕的瞬間 isMoving 就是 false,
  // 兩次滑動之間照樣會掃,等於沒延後(2026-09-08 已實測無效)。
  // 跟車時相機每幀都在動,故最多延後 MASK_DEFER_MS 一定要算一次,不會永遠不更新。
  const MASK_STILL_MS=400,MASK_DEFER_MS=15000;let maskTimer=0,maskDeferSince=0,lastMoveAt=0;
  function noteMove(){lastMoveAt=performance.now();}
  function runMasks(){
    maskDeferSince=0;if(disposed||!ownedSource||map.getSource('station-building-remainders')!==ownedSource)return;
    const active=[...records.filter(r=>r.stats.visible),...engineeringMasks];
    let changed=maskBuildings(clearance?[...records.filter(r=>r.maskActive),...engineeringMasks]:active);
    changed=maskLabels(active)||changed;
    if(changed){onUpdate(primary()?.stats);map.triggerRepaint();}
  }
  function scheduleMasks(){
    if(maskTimer||disposed)return;
    const now=performance.now();
    if(now-lastMoveAt<MASK_STILL_MS){
      if(!maskDeferSince)maskDeferSince=now;
      if(now-maskDeferSince<MASK_DEFER_MS){maskTimer=setTimeout(()=>{maskTimer=0;scheduleMasks();},150);return;}
    }
    maskTimer=setTimeout(()=>{maskTimer=0;runMasks();},0);
  }
  // 切換鏡頭可重用快取圖磚，不一定再發 content 事件；idle 時仍需重新辨識。
  // 實際 setFilter / setData 都有內容比對，不會因這次辨識啟動無限重繪。
  // 連續 render/idle 不能一直延後更新；快裝置會讓地形與模型永久不同步。
  // 合併這 100ms 內的事件，但保證第一個事件排定的更新能執行。
  function schedule(){if(timer||disposed)return;timer=setTimeout(()=>{timer=0;refresh();},100);}
  // 移動鏡頭可能換成已快取的圖磚，要重掃遮罩；一般 idle／地形更新只需重算高度。
  // openmaptiles 新資料由 sourceEpoch 使遮罩失效，不在每次 idle 強制掃建築物。
  function viewChanged(){
    // 跟車每幀都有 moveend；重用圖磚的遮罩等鏡頭暫停才重掃。
    // 模型高度仍由獨立的 schedule 準時更新，新圖磚則由 sourceEpoch 即時失效。
    clearTimeout(viewTimer);viewTimer=setTimeout(()=>{viewTimer=0;maskEpoch=-1;labelKey='';schedule();},100);schedule();
  }
  // MapLibre 5.9 的單張圖磚完成事件有 tile，但沒有 sourceDataType。
  // 只收 content 會漏掉拖回快取區域後的圖磚更新，使遮罩停在上一區。
  function sourceChanged(e){if(e.sourceDataType!=='content'&&!e.tile)return;if(e.sourceId==='openmaptiles'){sourceEpoch++;schedule();}else if(e.sourceId==='terrain')schedule();}
  return {
    id:'island-stations',type:'custom',renderingMode:'3d',failures,refresh,
    setEngineeringMasks(collection){
      const key=JSON.stringify(collection||null);if(key===engineeringMaskKey)return;engineeringMaskKey=key;
      engineeringMasks=(collection?.features||[]).map(f=>{const ring=f.geometry.coordinates[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return {meta:{id:'rail-'+f.properties.stationId,anchor:[xs.reduce((a,b)=>a+b)/xs.length,ys.reduce((a,b)=>a+b)/ys.length],displayHeightM:30},masks:f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates,maskBounds:[[Math.min(...xs)-.00002,Math.min(...ys)-.00002,Math.max(...xs)+.00002,Math.max(...ys)+.00002]],stats:{visible:true,excludedFeatureIds:[]}};});
      maskEpoch=-1;labelKey='';refresh();
    },
    get engineeringMasks(){return engineeringMasks.map(r=>r.stats);},get labelBounds(){return labelBounds;},
    get stats(){return primary()?.stats;},get model(){return primary()?.model;},get meta(){return primary()?.meta;},get footprint(){return primary()?.footprint;},
    getModel(id){return records.find(r=>r.meta.id===id)?.model||null;},
    get entries(){return records.map(r=>({key:r.entry.key,...r.stats}));},
    contains:(lng,lat)=>[...records,...engineeringMasks].some(r=>r.masks.some((mask,i)=>{const [w,s,e,n]=r.maskBounds[i];return lng>=w&&lng<=e&&lat>=s&&lat<=n&&inPolygon(lng,lat,mask);})),
    onAdd(_,gl){
      for(const l of map.getStyle().layers){if(l.id==='building-3d'||(l.type==='fill'&&l['source-layer']==='building'))filters.set(l.id,map.getFilter(l.id)||null);if(l.type==='symbol')symbolFilters.set(l.id,{original:map.getFilter(l.id)||null,sourceLayer:l['source-layer']});}
      map.addSource('station-building-remainders',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      ownedSource=map.getSource('station-building-remainders');
      const building=map.getStyle().layers.find(l=>l.id==='building-3d');
      if(building)map.addLayer({id:'station-building-context',type:'fill-extrusion',source:'station-building-remainders',minzoom:13,paint:building.paint},'building-3d');
      renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});renderer.autoClear=false;
      map.on('idle',schedule);map.on('moveend',viewChanged);map.on('sourcedata',sourceChanged);map.on('move',noteMove);refresh();
    },
    render(gl,args){labelBounds=[];const canvas=map.getCanvas();for(const r of records)if(r.stats.visible&&r.model){camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(r.transform));renderer.resetState();renderer.render(r.scene,camera);
      const points=[];for(const x of [r.labelBox.min.x,r.labelBox.max.x])for(const y of [r.labelBox.min.y,r.labelBox.max.y])for(const z of [r.labelBox.min.z,r.labelBox.max.z]){const p=new THREE.Vector3(x,y,z+r.stats.groundM).applyMatrix4(camera.projectionMatrix);if(p.z>=-1&&p.z<=1)points.push({x:(p.x+1)*canvas.clientWidth/2,y:(1-p.y)*canvas.clientHeight/2});}
      if(points.length){const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);labelBounds.push({id:r.meta.id,x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y});}
    }},
    onRemove(){if(disposed)return;disposed=true;clearTimeout(timer);clearTimeout(viewTimer);clearTimeout(maskTimer);map.off('idle',schedule);map.off('moveend',viewChanged);map.off('sourcedata',sourceChanged);map.off('move',noteMove);if(ownedSource&&map.getSource('station-building-remainders')===ownedSource){for(const [id,f] of filters)if(map.getLayer(id))map.setFilter(id,f);for(const [id,{original}] of symbolFilters)if(map.getLayer(id))map.setFilter(id,original);if(map.getLayer('station-building-context'))map.removeLayer('station-building-context');if(map.getSource('station-building-remainders'))map.removeSource('station-building-remainders');}for(const r of records)if(r.model)disposeStation(r.model);renderer?.dispose();}
  };
}
