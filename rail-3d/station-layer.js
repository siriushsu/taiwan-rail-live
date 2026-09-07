import * as THREE from './vendor/three.module.js';
import {buildTaipeiMain,buildStation,setStationInspection,disposeStation} from './station-models.js';
import {buildLandmark} from './landmark-models.js';
import {landmarkCatalog} from './landmark-catalog.js';
import {stationCatalog} from './station-catalog.js';
import {inPolygon,distanceToSegment} from './geo.js';

export async function createStationLayer(map,getState,onUpdate=()=>{}, {assetsBase=new URL('./assets/stations/',import.meta.url),maplibre=globalThis.maplibregl,clearance=null}={}){
  const failures=[],records=[],catalog=[...stationCatalog,...landmarkCatalog];
  await Promise.all(catalog.map(async entry=>{
    try{
      const read=async name=>{const r=await fetch(new URL(`${entry.id}/${name}`,assetsBase));if(!r.ok)throw Error(`${entry.name}模型資料載入失敗`);return r.json();};
      const [meta,footprint]=await Promise.all([read('metadata.json'),read('footprint.geojson')]);
      const features=footprint.type==='FeatureCollection'?footprint.features:[footprint];
      if(meta.id!==entry.id||meta.railElevationM!==null||!features.length)throw Error(`${entry.name}模型資料格式不符`);
      const masks=features.map(f=>f.geometry.coordinates);
      const maskBounds=masks.map(r=>{const xs=r[0].map(p=>p[0]),ys=r[0].map(p=>p[1]);return [Math.min(...xs)-.00002,Math.min(...ys)-.00002,Math.max(...xs)+.00002,Math.max(...ys)+.00002];});
      const anchor=maplibre.MercatorCoordinate.fromLngLat(meta.anchor,0),s=anchor.meterInMercatorCoordinateUnits();
      const transform=new THREE.Matrix4().makeTranslation(anchor.x,anchor.y,0).scale(new THREE.Vector3(s,-s,s));
      const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,1.65));const sun=new THREE.DirectionalLight(0xfff3db,1.8);sun.position.set(-160,-260,500);scene.add(sun);
      records.push({entry,meta,footprint,masks,maskBounds,scene,transform,model:null,lastUsed:0,
        stats:{id:meta.id,ready:false,visible:false,inspection:false,groundM:null,displayHeightM:meta.displayHeightM,railElevationM:null,realBuildingHeightM:meta.realBuildingHeightM||null,meshes:0,triangles:0,masked:false,excludedFeatureIds:[],revision:0}});
    }catch(error){failures.push({key:entry.key,message:error.message});}
  }));
  records.sort((a,b)=>catalog.findIndex(e=>e.id===a.meta.id)-catalog.findIndex(e=>e.id===b.meta.id));
  const camera=new THREE.Camera(),projection=new THREE.Matrix4(),filters=new Map(),symbolFilters=new Map(),appliedSymbols=new Map();
  let renderer,ownedSource,disposed=false,timer=0,sourceEpoch=0,maskEpoch=-1,maskKey='',contextKey='',labelKey='',lastVisible='',clock=0,engineeringMasks=[],engineeringMaskKey='',labelBounds=[];
  function primary(){return records.find(r=>r.entry.key===getState().place)||records.find(r=>r.stats.visible)||records[0];}
  function expandedBox(r,padding){const points=r.masks.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),dx=padding/(111320*Math.cos(r.meta.anchor[1]*Math.PI/180)),dy=padding/111320;return [Math.min(...xs)-dx,Math.min(...ys)-dy,Math.max(...xs)+dx,Math.max(...ys)+dy];}
  function rectangle([w,s,e,n]){return [[[w,s],[e,s],[e,n],[w,n],[w,s]]];}
  function maskBuildings(active){
    const visibleKey=active.map(r=>r.meta.id).join(',')+':'+(clearance?.revision||0);if(maskEpoch===sourceEpoch&&visibleKey===lastVisible)return false;
    maskEpoch=sourceEpoch;lastVisible=visibleKey;
    const ids=new Set();for(const r of [...records,...engineeringMasks]){r.stats.masked=r.stats.visible;r.stats.excludedFeatureIds=[];}
    const polygons=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    // 凹輪廓不能用中心放大當緩衝（凹角會把自己的頂點排除）。只容許 1.5m
    // 邊界量化差，並先以 bbox 淘汰遠處建物。
    const owner=p=>active.find(r=>p[0].every(q=>r.masks.some((mask,i)=>{const [w,s,e,n]=r.maskBounds[i];return q[0]>=w&&q[0]<=e&&q[1]>=s&&q[1]<=n&&(inPolygon(q[0],q[1],mask)||mask.some(ring=>ring.slice(1).some((b,k)=>distanceToSegment(q[0],q[1],ring[k],b)<1.5/111320)));})));
    const features=active.length||clearance?map.querySourceFeatures('openmaptiles',{sourceLayer:'building'}):[];
    // 圖磚會把站房和遠處建物合併成同一 MultiPolygon；拆出站房後，把其餘
    // 分件原位重畫，不能讓背景建物消失，也不能保留一個方塊蓋住新屋頂。
    for(const f of features)if(f.id!==undefined)for(const p of polygons(f)){const r=owner(p),blocked=clearance?.blocked(p);if(r||blocked){ids.add(f.id);if(r&&!r.stats.excludedFeatureIds.includes(f.id))r.stats.excludedFeatureIds.push(f.id);}}
    const remainders=new Map();for(const f of features)if(ids.has(f.id))for(const p of polygons(f))if(!owner(p)&&!clearance?.blocked(p)){const k=JSON.stringify([f.id,p]);remainders.set(k,{type:'Feature',properties:{...f.properties,station_original_id:f.id},geometry:{type:'Polygon',coordinates:p}});}
    const data={type:'FeatureCollection',features:[...remainders.keys()].sort().map(k=>remainders.get(k))},nextContext=JSON.stringify(data);let changed=false;
    if(nextContext!==contextKey){contextKey=nextContext;ownedSource.setData(data);changed=true;}
    const values=[...ids].sort((a,b)=>a-b),key=JSON.stringify(values);if(key!==maskKey){maskKey=key;for(const [id,original] of filters){const exclude=['!', ['in',['id'],['literal',values]]];map.setFilter(id,values.length?(original?['all',original,exclude]:exclude):original);}changed=true;}return changed;
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
      if(r.clearanceKey!==key){r.clearanceKey=key;if(r.model){r.scene.remove(r.model);disposeStation(r.model);r.model=null;r.stats.ready=false;r.stats.inspection=false;}r.stats.excludedComponents=resolved?.excluded||[];r.stats.clearanceHidden=!!resolved?.hidden;maskEpoch=-1;changed=true;}
      const visibleMeta=resolved?.meta||r.meta;
      r.maskActive=state.buildings&&map.getZoom()>=14&&near;
      const canShow=r.maskActive&&!resolved?.hidden;
      const ground=canShow?(state.terrain?(map.isSourceLoaded('terrain')?map.queryTerrainElevation(r.meta.anchor):null):0):null;
      const visible=canShow&&Number.isFinite(ground);let revision=r.stats.visible!==visible;
      if(visible&&!r.model){r.model=r.meta.landmarkType?buildLandmark(visibleMeta):r.meta.id==='taipei-main-v1'?buildTaipeiMain(visibleMeta):buildStation(visibleMeta,r.footprint);r.stats.groundM=null;r.stats.inspection=false;r.scene.add(r.model);r.labelBox=new THREE.Box3().setFromObject(r.model);r.stats.meshes=0;r.stats.triangles=0;r.model.traverse(o=>{if(o.isMesh){r.stats.meshes++;r.stats.triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});r.stats.ready=true;revision=true;}
      if(r.model){r.model.visible=visible;if(visible){r.lastUsed=++clock;if(r.stats.groundM!==ground){r.model.position.z=ground;r.stats.groundM=ground;revision=true;}const inspect=!!state.stationInspection&&(state.stationInspectionAll||r.entry.key===state.place);if(r.stats.inspection!==inspect){setStationInspection(r.model,inspect);r.stats.inspection=inspect;revision=true;}}}
      r.stats.visible=visible;if(revision){r.stats.revision++;changed=true;}
    }
    // 環島巡覽只保留最近三座的 GPU 幾何。
    const cached=records.filter(r=>r.model).sort((a,b)=>b.lastUsed-a.lastUsed);for(const r of cached.slice(3))if(!r.stats.visible){r.scene.remove(r.model);disposeStation(r.model);r.model=null;r.stats.ready=false;r.stats.inspection=false;}
    const active=[...records.filter(r=>r.stats.visible),...engineeringMasks];changed=maskBuildings(clearance?[...records.filter(r=>r.maskActive),...engineeringMasks]:active)||changed;changed=maskLabels(active)||changed;
    if(changed){onUpdate(primary()?.stats);map.triggerRepaint();}
  }
  // 切換鏡頭可重用快取圖磚，不一定再發 content 事件；idle 時仍需重新辨識。
  // 實際 setFilter / setData 都有內容比對，不會因這次辨識啟動無限重繪。
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{maskEpoch=-1;labelKey='';refresh();},100);}
  function sourceChanged(e){if(e.sourceId==='openmaptiles'&&e.sourceDataType==='content'){sourceEpoch++;schedule();}}
  return {
    id:'island-stations',type:'custom',renderingMode:'3d',failures,refresh,
    setEngineeringMasks(collection){
      const key=JSON.stringify(collection||null);if(key===engineeringMaskKey)return;engineeringMaskKey=key;
      engineeringMasks=(collection?.features||[]).map(f=>{const ring=f.geometry.coordinates[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return {meta:{id:'rail-'+f.properties.stationId,anchor:[xs.reduce((a,b)=>a+b)/xs.length,ys.reduce((a,b)=>a+b)/ys.length],displayHeightM:30},masks:f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates,maskBounds:[[Math.min(...xs)-.00002,Math.min(...ys)-.00002,Math.max(...xs)+.00002,Math.max(...ys)+.00002]],stats:{visible:true,excludedFeatureIds:[]}};});
      maskEpoch=-1;labelKey='';refresh();
    },
    get engineeringMasks(){return engineeringMasks.map(r=>r.stats);},get labelBounds(){return labelBounds;},
    get stats(){return primary()?.stats;},get model(){return primary()?.model;},get meta(){return primary()?.meta;},get footprint(){return primary()?.footprint;},
    get entries(){return records.map(r=>({key:r.entry.key,...r.stats}));},
    contains:(lng,lat)=>[...records,...engineeringMasks].some(r=>r.masks.some((mask,i)=>{const [w,s,e,n]=r.maskBounds[i];return lng>=w&&lng<=e&&lat>=s&&lat<=n&&inPolygon(lng,lat,mask);})),
    onAdd(_,gl){
      for(const l of map.getStyle().layers){if(l.id==='building-3d'||(l.type==='fill'&&l['source-layer']==='building'))filters.set(l.id,map.getFilter(l.id)||null);if(l.type==='symbol')symbolFilters.set(l.id,{original:map.getFilter(l.id)||null,sourceLayer:l['source-layer']});}
      map.addSource('station-building-remainders',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      ownedSource=map.getSource('station-building-remainders');
      const building=map.getStyle().layers.find(l=>l.id==='building-3d');
      map.addLayer({id:'station-building-context',type:'fill-extrusion',source:'station-building-remainders',minzoom:13,paint:building.paint},'building-3d');
      renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});renderer.autoClear=false;
      map.on('idle',schedule);map.on('moveend',schedule);map.on('sourcedata',sourceChanged);refresh();
    },
    render(gl,args){labelBounds=[];const canvas=map.getCanvas();for(const r of records)if(r.stats.visible&&r.model){camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(r.transform));renderer.resetState();renderer.render(r.scene,camera);
      const points=[];for(const x of [r.labelBox.min.x,r.labelBox.max.x])for(const y of [r.labelBox.min.y,r.labelBox.max.y])for(const z of [r.labelBox.min.z,r.labelBox.max.z]){const p=new THREE.Vector3(x,y,z+r.stats.groundM).applyMatrix4(camera.projectionMatrix);if(p.z>=-1&&p.z<=1)points.push({x:(p.x+1)*canvas.clientWidth/2,y:(1-p.y)*canvas.clientHeight/2});}
      if(points.length){const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);labelBounds.push({id:r.meta.id,x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y});}
    }},
    onRemove(){if(disposed)return;disposed=true;clearTimeout(timer);map.off('idle',schedule);map.off('moveend',schedule);map.off('sourcedata',sourceChanged);if(ownedSource&&map.getSource('station-building-remainders')===ownedSource){for(const [id,f] of filters)if(map.getLayer(id))map.setFilter(id,f);for(const [id,{original}] of symbolFilters)if(map.getLayer(id))map.setFilter(id,original);if(map.getLayer('station-building-context'))map.removeLayer('station-building-context');if(map.getSource('station-building-remainders'))map.removeSource('station-building-remainders');}for(const r of records)if(r.model)disposeStation(r.model);renderer?.dispose();}
  };
}
