import * as THREE from '../vendor/three.module.js';
import {registerTerrainProtocol} from '../terrain.js';
import {terrainArchive} from '../terrain-source.js';
import {createStationLayer} from '../station-layer.js';
import {createWenhuGeometry,createWenhuMaterial} from '../assets/wenhu-v1/wenhu.js';
import {createRailClearance} from './rail-clearance.js';
import {routeWidth,readableScale,stationNames,vehicleMarkers} from './readability.js';
import {formationFor,assembleFormation} from './formations.js';
import {makePath,shapeKey,makeHeightProfile,formationPoses} from './train-path.js';
import {profileLines} from './profile-lines.js';
import {createRailStructures} from './rail-structures.js';
import {headFramingDistance} from './follow-framing.js';
import {createLandscapeTrees} from './landscape-trees.js';
import {orderBuildingPasses} from './layer-order.js';

const asset=p=>new URL('../'+p,import.meta.url).href;
const json=async p=>{const r=await fetch(asset(p));if(!r.ok)throw Error(p+' 載入失敗');return r.json();};
let libraries;
function loadScript(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(Error('地圖程式載入失敗'));document.head.append(s);});}
async function library(){if(!libraries)libraries=(async()=>{
  // 主站與立體列車共用固定的 MapLibre 5.9.0。
  const ml=globalThis.maplibregl;if(ml.getVersion?.()!=='5.9.0')throw Error('整合預覽需要固定的 MapLibre 5.9.0');
  await loadScript(asset('vendor/pmtiles.js'));
  registerTerrainProtocol(ml,{archive:await terrainArchive(pmtiles)});return ml;
})();return libraries;}
const empty=()=>({type:'FeatureCollection',features:[]});
const feature=(geometry,properties)=>({type:'Feature',geometry,properties});

export async function createLiveMap({map,landscape=false,isCurrent=()=>true,onGesture,onInteract,onError,getHeading,trainSizeMode='readable',groundMode='flat',formationMode='actual'}){
  const assertCurrent=()=>{if(!isCurrent())throw new DOMException('地圖樣式已切換','AbortError');};
  const ml=await library(),[catalog,profileData]=await Promise.all([json('assets/blender-map-v1/manifest.json'),json('integration/display-profiles.json')]);
  assertCurrent();
  const el=map.getContainer(),landscapeTheme=landscape?'landscape':'original';
  let trees=null;
  let disposed=false,ready=false,stationLayer=null,stationLabels=null,markers=null,inspection=false,frame=null,routeKey='',routeRefs=[],lastBuild=0,dirty=true,buildCenter=null,buildElev=0,buildView=null,lastNear=null,popup=null;
  const clearance=createRailClearance();
  const terrainState={terrain:groundMode==='terrain',buildings:true,labels:true,stationInspection:false,stationInspectionAll:true,exaggeration:1};
  const scene=new THREE.Scene(),camera=new THREE.Camera(),projection=new THREE.Matrix4(),anchor=ml.MercatorCoordinate.fromLngLat([121,24]),unit=anchor.meterInMercatorCoordinateUnits();
  const transform=new THREE.Matrix4().makeTranslation(anchor.x,anchor.y,0).scale(new THREE.Vector3(unit,-unit,unit));
  const cache=new Map(),pending=new Map(),models=new Map(),failed=new Set(),paths=new WeakMap(),motion=new Map(),formations=new WeakMap();
  const rails=profileLines(scene),undergroundRails=profileLines(scene,{underground:true}),structures=createRailStructures(scene);
  let followingCamera=false,zoomFollows=null,followReturn=null,framingView=null;const pointers=new Set();
  let profileVertices=[],gesture=false,gesturePanned=false,gestureOrbited=false,gestureTimer=0,ambientWas=false,ambientView=null,cameraAt=0,orbitBearing=0;
  const material=createWenhuMaterial(THREE);material.transparent=false;material.opacity=1;
  // 在 CPU 的雙精度矩陣先合成每節車的投影，避免 GPU 以全台公尺座標做大數相減。
  // 只替換列車材質；路線、底圖、建物與車體的實際位置完全沿用原本資料。
  material.uniforms.trainClipMatrix={value:new THREE.Matrix4()};
  material.vertexShader='uniform mat4 trainClipMatrix;\n'+material.vertexShader.replace('projectionMatrix*modelViewMatrix*vec4(position,1.0)','trainClipMatrix*vec4(position,1.0)');
  material.onBeforeRender=(_renderer,_scene,view,_geometry,mesh)=>{material.uniforms.trainClipMatrix.value.multiplyMatrices(view.projectionMatrix,mesh.modelViewMatrix);material.uniformsNeedUpdate=true;};
  const undergroundMaterial=material.clone();undergroundMaterial.transparent=true;undergroundMaterial.depthTest=true;undergroundMaterial.depthWrite=false;
  undergroundMaterial.fragmentShader=undergroundMaterial.fragmentShader.replace(')),1.);}', ')),.42);}');
  undergroundMaterial.onBeforeRender=(_renderer,_scene,view,_geometry,mesh)=>{undergroundMaterial.uniforms.trainClipMatrix.value.multiplyMatrices(view.projectionMatrix,mesh.modelViewMatrix);undergroundMaterial.uniformsNeedUpdate=true;};
  const vehicleDepthMaterial=material.clone();vehicleDepthMaterial.colorWrite=false;vehicleDepthMaterial.depthWrite=true;vehicleDepthMaterial.depthTest=true;
  vehicleDepthMaterial.onBeforeRender=(_renderer,_scene,view,_geometry,mesh)=>{vehicleDepthMaterial.uniforms.trainClipMatrix.value.multiplyMatrices(view.projectionMatrix,mesh.modelViewMatrix);vehicleDepthMaterial.uniformsNeedUpdate=true;};
  scene.add(new THREE.AmbientLight(0xffffff,1.9));const sun=new THREE.DirectionalLight(0xfff3dc,2);sun.position.set(-100,-150,300);scene.add(sun);
  const sprite=document.createElement('canvas');sprite.width=sprite.height=32;const sc=sprite.getContext('2d');sc.fillStyle='#fff';sc.beginPath();sc.arc(16,16,13,0,Math.PI*2);sc.fill();
  const pointTexture=new THREE.CanvasTexture(sprite);
  const pointGeometry=new THREE.BufferGeometry(),pointMaterial=new THREE.PointsMaterial({size:10,map:pointTexture,alphaTest:.5,sizeAttenuation:false,vertexColors:true,depthTest:true});
  const points=new THREE.Points(pointGeometry,pointMaterial);points.frustumCulled=false;scene.add(points);
  const arrowGeometry=new THREE.BufferGeometry(),arrowMaterial=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  const arrows=new THREE.Mesh(arrowGeometry,arrowMaterial);arrows.frustumCulled=false;scene.add(arrows);let arrowPositions=new Float32Array(0),arrowColors=new Float32Array(0);
  const inputListeners=[];
  let vehicleLayer,underlayLayer,undergroundLayer,webgl,positions=new Float32Array(0),colors=new Float32Array(0),hits=[];
  const stats={structures:structures.stats,frames:0,vehicles:0,models:0,routeBuilds:0,geometryVersion:null,railElevationM:null,displayHeight:terrainState.terrain?'DEM + estimated rail levels':'estimated rail levels',groundMode,landscapeTheme,trainSizeMode,formationMode,errors:[],poseSamples:[],get stationLabels(){return stationLabels?.count||0;},get routeWidthPx(){return routeWidth(map.getZoom());}};
  const report=e=>{const text=e?.message||String(e);if(stats.errors.length<20)stats.errors.push(text);onError?.(text);};
  function world(coord,height){const m=ml.MercatorCoordinate.fromLngLat(coord);return [(m.x-anchor.x)/unit,-(m.y-anchor.y)/unit,height*m.meterInMercatorCoordinateUnits()/unit];}
  function height(coord){if(!terrainState.terrain)return .65;const h=map.queryTerrainElevation(coord);return Number.isFinite(h)?h+.65:null;}
  function pathFor(route){if(!route?.coordinates?.length)return null;if(route.physical&&route.path){route.path.elevation=route.elevation;route.path.level=route.level;return route.path;}let p=paths.get(route.coordinates);if(!p){p=makePath(route.coordinates,route.loop);const data=profileData.entries[shapeKey(route.coordinates)];p.elevation=route.elevation||(data&&Math.abs(data.lengthM-p.length)<.01?makeHeightProfile(data.values,data.stepM,p.length):null);p.level=route.level;paths.set(route.coordinates,p);}
    if(!route.physical&&!p.level&&globalThis.railIslandPhysical?.systems?.includes(route.systemId))p.level=s=>{
      const q=p.at(s);if(!q)return null;const a=p.coordinates[q.index],b=p.coordinates[q.index+1],angle=Math.atan2(b[1]-a[1],(b[0]-a[0])*Math.cos(q.coordinate[1]*Math.PI/180));
      return globalThis.railIslandPhysical.displayLevelAt(route.systemId,q.coordinate,angle)||{kind:'surface',offsetM:0,estimated:true,displayOnly:true};
    };return p;
  }
  function railHeight(path,s){
    if(path)s=Math.max(0,Math.min(path.length,s));
    // 實體軌道以畫面地表為基準；舊 DEM 淨空含全線 +2.5m，不能再把它當路基高度。
    // 軌道、逐節車廂及跟車鏡頭共用此函式，保留交會層差，不以橋墩填補資料誤差。
    if(path?.level){const absolute=terrainState.terrain?path.level(s)?.terrainHeightM:undefined;if(Number.isFinite(absolute))return Number.isFinite(map.queryTerrainElevation(path.at(s).coordinate))?absolute+.65:null;const ground=terrainState.terrain?map.queryTerrainElevation(path.at(s).coordinate):0,level=path.level(s),offset=level?.offsetM??0;return Number.isFinite(ground)?ground+offset+.65:null;}
    const h=path?.elevation?(terrainState.terrain?path.elevation(s):0):terrainState.terrain?null:0;return Number.isFinite(h)?h+.65:null;
  }
  function isUnderground(path,s){const level=path?.level?.(s);return level?.kind==='tunnel'||(level?.kind!=='bridge'&&(level?.offsetM??0)<-3);}
  function clearLines(){stats.undergroundRailSegments=0;profileVertices=[];rails.set([]);undergroundRails.set([]);structures.set([],[]);}
  function rebuildLines(){
    clearLines();if(!frame)return;const c=map.getCenter(),near=map.getZoom()>=14,bounds=map.getBounds(),margin=.004;lastNear=near;buildCenter=[c.lng,c.lat];buildElev=terrainState.terrain?map.queryTerrainElevation(buildCenter):0;buildView=[map.getZoom(),map.getPitch(),map.getBearing()];lastBuild=performance.now();dirty=false;stats.routeBuilds++;

    if(!near)return;const lineSegments=[],buriedSegments=[],structureSegments=[],piers=[];
    const ground=q=>terrainState.terrain?map.queryTerrainElevation(q):0;
    for(const r of frame.routes){const coords=r.coordinates,vertices=[],path=pathFor(r);for(let i=1;i<coords.length;i++){
      const a=coords[i-1],b=coords[i];if(Math.min(a[0],b[0])>bounds.getEast()+margin||Math.max(a[0],b[0])<bounds.getWest()-margin||Math.min(a[1],b[1])>bounds.getNorth()+margin||Math.max(a[1],b[1])<bounds.getSouth()-margin)continue;
      for(const [lo,hi] of r.drawingRanges||[[0,Infinity]]){
      const start=Math.max(path.d[i-1],lo),end=Math.min(path.d[i],hi);if(end<=start)continue;
      const length=end-start,n=(terrainState.terrain||path.level)?Math.max(1,Math.ceil(length/5)):1;let prev=null,prevGround=null;
      for(let k=0;k<=n;k++){const s=start+length*k/n,q=path.at(Math.min(path.length,s)).coordinate,h=railHeight(path,s),p=h===null?null:world(q,h);if(prev&&p){vertices.push(...prev,...p);if(terrainState.terrain||r.physical||r.drawingRanges)(isUnderground(path,s)?buriedSegments:lineSegments).push({a:prev,b:p,color:r.displayColor||r.color,physical:!!r.physical});}
        if(r.physical&&p&&!isUnderground(path,s)){
          const g=ground(q),gp=Number.isFinite(g)?world(q,g)[2]:null,level=path.level?.(s),scale=ml.MercatorCoordinate.fromLngLat(q).meterInMercatorCoordinateUnits()/unit;
          if(prev&&Number.isFinite(gp)&&Number.isFinite(prevGround))structureSegments.push({a:prev,b:p,groundA:prevGround,groundB:gp,bridge:level?.kind==='bridge'&&level.offsetM>0,transition:!!level?.terrainTransition,scale});
          prevGround=gp;
        }else prevGround=null;
        prev=p;}
      // 橋墩沿來源 way 的固定里程放置，平移視角不會使橋墩滑動；地形未載入時不猜地面高度。
      if(r.physical)for(let s=Math.ceil(start/32)*32;s<end;s+=32){
        const level=path.level?.(s);if(level?.kind!=='bridge'||level.offsetM<=0)continue;
        const point=path.at(s),q=point.coordinate,h=railHeight(path,s),g=ground(q);if(!Number.isFinite(h)||!Number.isFinite(g))continue;
        const scale=ml.MercatorCoordinate.fromLngLat(q).meterInMercatorCoordinateUnits()/unit;
        piers.push({p:world(q,h),ground:world(q,g)[2],angle:Math.atan2(b[1]-a[1],(b[0]-a[0])*Math.cos(q[1]*Math.PI/180)),scale,coordinate:q,railHeightM:h,groundM:g});
      }
      }
    }if(vertices.length)profileVertices.push(vertices);}rails.set(lineSegments);undergroundRails.set(buriedSegments);structures.set(structureSegments,piers);stats.undergroundRailSegments=buriedSegments.length;
  }
  async function geometry(id){if(cache.has(id))return cache.get(id);if(!pending.has(id))pending.set(id,(async()=>{
    const meta=catalog.meshes[id],r=await fetch(asset('assets/blender-map-v1/'+meta.file));if(!r.ok)throw Error('列車模型載入失敗');const b=await r.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(b.byteLength!==meta.byteLength||hash!==meta.sha256)throw Error('列車模型版本不符');
    const data=new Float32Array(b.byteLength/4),view=new DataView(b);for(let i=0;i<data.length;i++)data[i]=view.getFloat32(i*4,true);const g=createWenhuGeometry(THREE,{data});if(disposed){g.dispose();return null;}cache.set(id,g);return g;
  })());try{return await pending.get(id);}finally{pending.delete(id);}}
  function modelFor(spec){if(!spec)return null;if(!formations.has(spec))formations.set(spec,assembleFormation(spec,catalog));return formations.get(spec);}
  async function ensureModel(v){const spec=formationFor(v,formationMode);if(!spec)return;const old=models.get(v.id);if(old&&old.key!==spec.key){if(old.group)scene.remove(old.group);models.delete(v.id);}if(models.has(v.id)||failed.has(v.id))return;
    const ticket={loading:true,key:spec.key};models.set(v.id,ticket);try{const model=modelFor(spec),geometries=await Promise.all(model.parts.map(p=>geometry(p.mesh)));if(disposed||models.get(v.id)!==ticket)return;
      const group=new THREE.Group(),cars=model.parts.map((part,i)=>{const car=new THREE.Group(),mesh=new THREE.Mesh(geometries[i],material),meta=catalog.meshes[part.mesh],sx=part.bodyLengthM/(meta.max[0]-meta.min[0]),sy=model.widthM/(meta.max[1]-meta.min[1]);mesh.scale.set(sx,sy,sy);mesh.position.set(-(meta.min[0]+meta.max[0])/2*sx+part.bodyShiftM*(part.flip?-1:1),0,-meta.min[2]*sy);mesh.renderOrder=3;car.add(mesh);group.add(car);return car;});group.visible=false;scene.add(group);models.set(v.id,{group,cars,model,key:spec.key});
    }catch(e){if(!disposed&&models.get(v.id)===ticket){models.delete(v.id);failed.add(v.id);report(e);}}
  }
  // 只從這班車自己的來源路線取車體切線；車輛錨點保持原站經緯度，無跨線吸附。
  function tangent(v){const coord=[v.longitude,v.latitude],shape=v.route?.coordinates;if(!shape||shape.length<2)return 0;let best=Infinity,angle=0;
    for(let i=1;i<shape.length;i++){const a=shape[i-1],b=shape[i],x=(a[0]-coord[0])*101000,y=(a[1]-coord[1])*111320,dx=(b[0]-a[0])*101000,dy=(b[1]-a[1])*111320,d=dx*dx+dy*dy;if(d===0)continue;
      const t=Math.max(0,Math.min(1,-(x*dx+y*dy)/d)),dist=(x+t*dx)**2+(y+t*dy)**2;if(dist<best){best=dist;angle=Math.atan2(dy,dx);}}
    return angle;
  }
  function routeProfile(v){const path=pathFor(v.route);if(!path)return null;const old=motion.get(v.id),hint=Number.isFinite(v.chainageM)?v.chainageM:old?.path===path?old.s:null;let nearest=path.locate([v.longitude,v.latitude],hint);if(!nearest||nearest.error>3)nearest=path.locate([v.longitude,v.latitude]);if(!nearest||nearest.error>3)return null;
    const heading=getHeading?.(v),direction=Math.abs(v.railDirection)===1?v.railDirection:v.sourceKind==='timetable'&&v.systemId.endsWith('_sched')&&Math.abs(v.direction)===1?v.direction:heading!=null?(Math.cos(heading-nearest.angle)>=0?1:-1):old?.direction||1;
    motion.set(v.id,{path,s:nearest.s,direction});const h=railHeight(path,nearest.s);
    return {...nearest,path,direction,height:h,distance:nearest.error,z:h===null?null:world([v.longitude,v.latitude],h)[2]};
  }
  function syncRoutes(next){const key=next.routes.map(r=>r.id+':'+(r.displayColor||r.color)).join('|');if(key===routeKey&&next.routes.every((r,i)=>routeRefs[i]===r.coordinates))return;
    routeKey=key;routeRefs=next.routes.map(r=>r.coordinates);dirty=true;
  }
  function update(next){if(!ready||disposed)return;frame=next;
    syncZoomAnchor();
    if(clearance.update([...(next.clearanceRoutes||next.routes),...next.vehicles.filter(v=>!v.route?.physical).map(v=>v.route).filter(Boolean)]))stationLayer?.refresh();
    trees?.refresh();
    syncRoutes(next);stats.vehicles=next.vehicles.length;stats.geometryVersion=next.geometryVersion;
    const now=performance.now(),center=map.getCenter(),near=map.getZoom()>=14;
    if(buildView&&(Math.abs(map.getZoom()-buildView[0])>.4||Math.abs(map.getPitch()-buildView[1])>5||Math.abs(map.getBearing()-buildView[2])>15))dirty=true;
    // 單一到貨事件可能早於整片 DEM 到齊:建置當時的地面高程若已經不同,同樣要重建。
    if(terrainState.terrain&&buildCenter){const e=map.queryTerrainElevation(buildCenter);if(Number.isFinite(e)&&Math.abs(e-buildElev)>.5)dirty=true;}
    if(near!==lastNear||((dirty||!buildCenter||Math.hypot(center.lng-buildCenter[0],center.lat-buildCenter[1])>.003)&&now-lastBuild>250))rebuildLines();
    const all=next.display?.modelMode==='all'||!!next.display?.ambient,bounds=map.getBounds();
    // 同一縮放門檻及比例函式用於每一輛模型；一般模式只有選取車，全部模式涵蓋畫面內可用車型。
    const candidates=next.vehicles.map(v=>({v})).filter(({v})=>near&&(all||v.followed)&&(v.followed||bounds.contains([v.longitude,v.latitude]))&&next.display?.enabled!==false&&formationFor(v,formationMode));
    stats.modelMode=all?'all':'selected';stats.modelCandidates=candidates.length;
    const wanted=new Set(candidates.map(x=>x.v.id));for(const [id,m]of models)if(!wanted.has(id)){if(m.group)scene.remove(m.group);models.delete(id);}
    for(const {v}of candidates)void ensureModel(v);
    if(!pointGeometry.attributes.position||positions.length!==next.vehicles.length*3){positions=new Float32Array(next.vehicles.length*3);colors=new Float32Array(positions.length);pointGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));pointGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));}
    const ids=new Set(next.vehicles.map(v=>v.id));for(const id of motion.keys())if(!ids.has(id))motion.delete(id);
    hits=[];stats.models=0;stats.undergroundModels=0;stats.poseSamples=[];stats.modelFallbacks=[];const arrowP=[],arrowC=[];
    next.vehicles.forEach((v,i)=>{const coord=[v.longitude,v.latitude],profile=near&&(terrainState.terrain||v.route?.level||wanted.has(v.id))&&Math.hypot(coord[0]-center.lng,coord[1]-center.lat)<.08?routeProfile(v):null,ratio=ml.MercatorCoordinate.fromLngLat(coord).meterInMercatorCoordinateUnits()/unit,
      h=profile?.height??height(coord),p=world(coord,h??.65),m=models.get(v.id),color=new THREE.Color(v.followed?'#d65130':v.color||'#287766');
      positions.set(p,i*3);colors.set([color.r,color.g,color.b],i*3);const hit={v,p,modelled:false};hits.push(hit);
      if(m?.group){const poses=profile&&h!==null&&(!terrainState.terrain||profile.path.elevation||profile.path.level)?formationPoses(profile.path,profile.s,profile.direction*(v.formationFacing||1),m.model.parts,s=>railHeight(profile.path,s)):null;m.group.visible=!!poses;
        if(poses){const displayScale=m.displayScale??1;
          // 「透視顯示」切到實體時,地下列車改用實色車體:仍留在地下圖層,與地面列車的前後關係不變,只是不再半透明。
          // 地下軌道線照舊半透明(profile-lines 的 .32),所以還看得出這一段在地下——2026-09-10 裁示只讓列車變實色。
          m.cars.forEach((car,k)=>{const part=m.model.parts[k],pose=poses[k],r=ml.MercatorCoordinate.fromLngLat(pose.coordinate).meterInMercatorCoordinateUnits()/unit;pose.underground=isUnderground(profile.path,pose.s);car.children[0].material=(pose.translucent=pose.underground&&inspection)?undergroundMaterial:material;car.children[0].layers.set(pose.underground?1:0);car.children[0].layers.enable(2);car.position.set(...world(pose.coordinate,pose.height));car.scale.set(r,r*displayScale,r);car.rotation.set(0,part.flip?pose.pitch:-pose.pitch,pose.angle+(part.flip?Math.PI:0),'ZYX');});
          stats.undergroundModels+=poses.some(p=>p.underground)?1:0;hit.modelled=true;positions[i*3+2]=-1e7;stats.models++;stats.poseSamples.push({id:v.id,coordinate:coord,displayHeightM:h,railElevationM:null,level:profile.path.level?.(profile.s)||null,underground:poses.some(p=>p.underground),angle:poses[0].angle,displayScale,lengthScale:1,lengthM:m.model.lengthM,carCount:m.cars.length,formationQuality:m.model.quality,formationMode,modelId:m.model.id,actualCarCount:m.model.actualCarCount,countBasis:m.model.countBasis,lengthKnown:m.model.lengthKnown,caption:m.model.caption,cars:poses});
          m.screenPose={p,angle:poses[0].angle,ratio,sample:stats.poseSamples.at(-1),physical:!!v.route?.physical};
        }else stats.modelFallbacks.push({id:v.id,reason:!profile?'來源位置不在線形上':terrainState.terrain&&!profile.path.elevation?'缺少固定顯示高程':'編組超出已知線形端點'});
      }else if(v.followed&&!formationFor(v,formationMode))stats.modelFallbacks.push({id:v.id,reason:'車型或編組長度尚未確認'});
      const screen=!markers&&next.display?.dirArrow?project(p):null;
      const heading=screen&&screen.z>=-1&&screen.z<=1&&screen.x>=0&&screen.y>=0&&screen.x<=el.clientWidth&&screen.y<=el.clientHeight&&!m?.group?.visible&&h!==null?getHeading?.(v):null;
      if(heading!==null&&heading!==undefined){const angle=heading,dx=Math.cos(angle),dy=Math.sin(angle),a=screen,b=project([p[0]+dx*ratio,p[1]+dy*ratio,p[2]]),s=ratio/Math.max(.015,Math.hypot(b.x-a.x,b.y-a.y));
        for(const [x,y]of [[12,0],[5,3],[5,-3]]){arrowP.push(p[0]+(dx*x-dy*y)*s,p[1]+(dy*x+dx*y)*s,p[2]+.1);arrowC.push(color.r,color.g,color.b);}}
    });
    // 每節車廂的位置直接取自指派股道的里程；過岔道時自然逐節轉向。
    // 近距離或地表投影交疊不等於共用股道，不能再整列橫移來掩蓋派軌衝突。
    if(!arrowGeometry.attributes.position||arrowPositions.length!==arrowP.length){arrowPositions=new Float32Array(arrowP.length);arrowColors=new Float32Array(arrowP.length);arrowGeometry.setAttribute('position',new THREE.BufferAttribute(arrowPositions,3));arrowGeometry.setAttribute('color',new THREE.BufferAttribute(arrowColors,3));}
    arrowPositions.set(arrowP);arrowColors.set(arrowC);arrowGeometry.attributes.position.needsUpdate=true;arrowGeometry.attributes.color.needsUpdate=true;arrowGeometry.setDrawRange(0,arrowP.length/3);stats.directionArrows=arrowP.length/9;
    pointGeometry.attributes.position.needsUpdate=true;pointGeometry.attributes.color.needsUpdate=true;pointGeometry.computeBoundingSphere();
    // 換車後釋放用不到的精修網格；保留小型快取，避免走遍全台後把整座車庫常駐 GPU。
    if(cache.size>18&&![...models.values()].some(m=>m.loading)){const used=new Set([...models.values()].flatMap(m=>m.model?.parts.map(p=>p.mesh)||[]));for(const [id,g]of cache){if(cache.size<=18)break;if(!used.has(id)){g.dispose();cache.delete(id);}}}
    stats.appearance='blender-map-lod';stats.cachedMeshes=cache.size;
    syncAmbient(!!next.display?.ambient && next.display?.ambientStyle==='follow');map.triggerRepaint();
  }
  function syncZoomAnchor(){
    const follows=!!frame?.followLock&&!!frame?.selectedVehicleId;
    if(!follows){followReturn=null;stats.followReturning=false;}
    if(gesture||ambientWas||zoomFollows===follows)return;
    // enable 本身不會更新已啟用的滾輪選項；僅在跟車鎖改變、沒有手勢時重設。
    // 只換選項、不換開關：ambientWas 是在同一次 render 的最後才更新，放空跟車第一次咬到車的那一幀
    // 這裡的 ambientWas 還是 false ⇒ 無條件 enable 會把主站放空鎖起來的滾輪／捏合偷偷解鎖
    //（放空的相機主權見 index.html setMapGestures；只有這兩顆會被解鎖，dragPan 仍鎖著 ⇒ 安全網看不見）。
    const options=follows?{around:'center'}:undefined;
    for(const handler of [map.scrollZoom,map.touchZoomRotate]){const was=handler.isEnabled();handler.disable();if(was)handler.enable(options);}
    zoomFollows=follows;
  }
  function updateModelScales(){
    // MapLibre 已給出本幀縮放／旋轉矩陣後才求螢幕寬度；所有車輛共用這個時點。
    for(const m of models.values())if(m.group?.visible&&m.screenPose){const {p,angle,ratio,sample}=m.screenPose;
      const scale=m.screenPose.physical?1:readableScale(m.model,p,angle,ratio,map.getZoom(),project,trainSizeMode);
      for(const car of m.cars)car.scale.y=car.scale.x*scale;
      m.displayScale=sample.displayScale=scale;
    }
  }
  function project(p){const a=new THREE.Vector3(...p).applyMatrix4(camera.projectionMatrix);return {x:(a.x+1)*map.getCanvas().clientWidth/2,y:(1-a.y)*map.getCanvas().clientHeight/2,z:a.z};}
  function syncAmbient(on){if(on===ambientWas)return;ambientWas=on;cameraAt=performance.now();
    if(on){ambientView={pitch:map.getPitch(),bearing:map.getBearing(),zoom:map.getZoom()};orbitBearing=map.getBearing();}
    if(!on&&ambientView){ambientView=null;zoomFollows=null;syncZoomAnchor();}
  }
  function cinematicPose(v){if(!ambientWas||!v)return null;const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-cameraAt)/1000));cameraAt=now;
    const mode=frame.display.ambientCamera||'side',heading=90-(getHeading?.(v)??tangent(v))*180/Math.PI,target=heading+65;
    if(mode==='orbit')orbitBearing+=dt*4;
    else{const delta=((target-orbitBearing+540)%360)-180;orbitBearing+=delta*(1-Math.exp(-dt*1.4));}
    stats.ambientCamera=mode;return {bearing:orbitBearing,pitch:mode==='orbit'?52:62,zoom:Math.max(15.6,map.getZoom())};
  }
  function destroy(){if(disposed)return;disposed=true;trees?.destroy();clearTimeout(gestureTimer);for(const [target,type,handler]of inputListeners)target.removeEventListener(type,handler,true);
    for(const [type,handler]of mapListeners)map.off(type,handler);if(stationLayer){if(map.getLayer(stationLayer.id)?.implementation===stationLayer)map.removeLayer(stationLayer.id);else stationLayer.onRemove();}
    if(vehicleLayer&&map.getLayer('live-vehicles-3d')===vehicleLayer)map.removeLayer('live-vehicles-3d');if(underlayLayer&&map.getLayer('live-vehicles-underlay')===underlayLayer)map.removeLayer('live-vehicles-underlay');
    if(undergroundLayer&&map.getLayer('live-underground-3d')===undergroundLayer)map.removeLayer('live-underground-3d');
    clearLines();for(const m of models.values())if(m.group)scene.remove(m.group);models.clear();rails.destroy();undergroundRails.destroy();structures.destroy();undergroundMaterial.dispose();vehicleDepthMaterial.dispose();for(const g of cache.values())g.dispose();material.dispose();pointGeometry.dispose();pointMaterial.dispose();pointTexture.dispose();arrowGeometry.dispose();arrowMaterial.dispose();webgl?.dispose();}
  const mapListeners=[];const listenMap=(type,handler)=>{map.on(type,handler);mapListeners.push([type,handler]);};
  try{
    if(!map.getSource('terrain'))map.addSource('terrain',{type:'raster-dem',tiles:['island-dem://{z}/{x}/{y}'],minzoom:0,maxzoom:12,tileSize:512,encoding:'terrarium',attribution:'<a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener">© Mapterhorn · 內政部 20m DTM</a>'});
    if(terrainState.terrain)map.setTerrain({source:'terrain',exaggeration:1});
    if(landscape){
      map.addLayer({id:'landscape-hillshade',type:'hillshade',source:'terrain',paint:{'hillshade-exaggeration':.42,'hillshade-shadow-color':'#5c785f','hillshade-highlight-color':'#fff4d6','hillshade-accent-color':'#90a580','hillshade-illumination-direction':315}},'building');
      const light={anchor:'map',color:'#fff2d7',intensity:.36,position:[1.5,210,45]};
      if(window.railIslandSunlight)window.railIslandSunlight.setBaseLight(light);else map.setLight(light);
      trees=createLandscapeTrees({map,THREE,scene,world,clearance,getTerrain:()=>terrainState.terrain});
      stats.landscape=trees.stats;
    }
    points.visible=arrows.visible=false;
    map.addLayer({id:'live-vehicles-3d',type:'custom',renderingMode:'3d',onAdd(_,gl){webgl=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl});webgl.autoClear=false;},
      render(gl,args){camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform));updateModelScales();structures.setVisible(map.getZoom()>=14);rails.render(el.clientWidth,el.clientHeight,routeWidth(map.getZoom()),map.getZoom()>=14&&(terrainState.terrain||frame?.routes.some(r=>r.physical||r.drawingRanges)),frame?.display?.dark);webgl.resetState();webgl.render(scene,camera);stats.frames++;
        const lead=models.get(frame?.selectedVehicleId)?.cars?.[0],pad=map.getPadding();
        stats.headLockErrorPx=frame?.headLocked&&lead?Math.hypot(project(lead.position.toArray()).x-(el.clientWidth+pad.left-pad.right)/2,project(lead.position.toArray()).y-(el.clientHeight+pad.top-pad.bottom)/2):null;
      }});vehicleLayer=map.getLayer('live-vehicles-3d');
    // 透明 extrusion 仍寫深度；先在牆面下畫一次車體，才有真實車色可供玻璃混合。
    // 最後的正常深度 pass 再恢復位於建築前方的車體，路線不會蓋住車身。
    if(map.getLayer('building-3d'))map.addLayer({id:'live-vehicles-underlay',type:'custom',renderingMode:'3d',render(gl,args){
      if(!terrainState.stationInspection)return;camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform));updateModelScales();
      rails.render(el.clientWidth,el.clientHeight,0,false);webgl.resetState();webgl.render(scene,camera);
    }},'building-3d');underlayLayer=map.getLayer('live-vehicles-underlay');
    // 衛星底圖沒有 openmaptiles / building-3d，獨立 Blender 模型仍需建立。
    {stationLayer=await createStationLayer(map,()=>terrainState,()=>{}, {maplibre:ml,clearance});assertCurrent();map.addLayer(stationLayer);for(const e of stationLayer.failures)report(e.message);}
    map.addLayer({id:'live-underground-3d',type:'custom',renderingMode:'3d',render(gl,args){
      if(!stats.undergroundModels&&!stats.undergroundRailSegments)return;
      camera.projectionMatrix.copy(projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform));
      // 只對地下模型建立自己的深度，再半透明混合；不讓背面及內部三角形累積成黑色雜點。
      undergroundRails.render(el.clientWidth,el.clientHeight,0,false);
      webgl.resetState();webgl.clearDepth();
      // 先保留所有車體的前後關係，僅略過地表與建物；地下透視不能蓋過上層列車。
      camera.layers.set(2);scene.overrideMaterial=vehicleDepthMaterial;webgl.render(scene,camera);scene.overrideMaterial=null;camera.layers.set(1);
      undergroundRails.render(el.clientWidth,el.clientHeight,routeWidth(map.getZoom()),map.getZoom()>=14,frame?.display?.dark);webgl.render(scene,camera);camera.layers.set(0);
    }});undergroundLayer=map.getLayer('live-underground-3d');
    orderBuildingPasses(map);
    function startGesture(e){if(!e.originalEvent)return;onInteract?.();if(!gesture){gesturePanned=false;gestureOrbited=false;followReturn=null;stats.followReturning=false;}gesture=true;clearTimeout(gestureTimer);}
    // 在引擎下一個 rAF 處理手勢前就保留操作權，避免跟車 jumpTo 先中止輸入。
    function listen(target,type,handler){target.addEventListener(type,handler,{capture:true,passive:true});inputListeners.push([target,type,handler]);}
    listen(map.getCanvas(),'pointerdown',e=>{pointers.add(e.pointerId);startGesture({originalEvent:e});
      // 滑鼠拖出畫布仍由同一畫布接到放開，避免引擎一直停在旋轉中。
      if(e.isTrusted&&e.pointerType==='mouse')map.getCanvas().setPointerCapture(e.pointerId);
    });
    for(const type of ['pointerup','pointercancel'])listen(document,type,e=>{if(pointers.delete(e.pointerId))finishGesture();});
    listen(map.getCanvas(),'wheel',e=>{startGesture({originalEvent:e});gestureOrbited=true;finishGesture();});
    listen(window,'blur',e=>{if(e.target===window){pointers.clear();finishGesture();}});
    listenMap('movestart',startGesture);
    listenMap('move',e=>{if(e.originalEvent)onInteract?.();});
    listenMap('dragstart',e=>{startGesture(e);if(e.originalEvent){gesturePanned=true;const input=e.originalEvent;
      // 單指／左鍵平移可立即解鎖；雙指與右鍵需留給旋轉、縮放的組合手勢。
      if(input.touches?input.touches.length===1:input.button===0&&!input.ctrlKey)onGesture();}});
    for(const type of ['zoomstart','rotatestart','pitchstart'])listenMap(type,e=>{startGesture(e);if(e.originalEvent)gestureOrbited=true;});
    function finishGesture(){clearTimeout(gestureTimer);if(!gesture)return;gestureTimer=setTimeout(()=>{if(pointers.size||map.isMoving()){finishGesture();return;}const pan=gesturePanned&&!gestureOrbited;gesture=false;gesturePanned=gestureOrbited=false;if(pan&&!frame?.headLocked)onGesture();else if(frame?.followLock&&frame.selectedVehicleId)followReturn={id:frame.selectedVehicleId};},80);}
    listenMap('moveend',e=>{if(e.originalEvent)dirty=true;if(gesture)finishGesture();});
    // 圖磚到貨的 sourcedata 帶的是 e.tile,sourceDataType 是 undefined(只有 metadata／visibility 才有值),
    // 舊條件永遠不成立 ⇒ DEM 晚於首次建置抵達時,橋墩與橋面會一直停在 0m 被地形埋住。
    listenMap('sourcedata',e=>{if(terrainState.terrain&&e.sourceId==='terrain'&&(e.tile||e.sourceDataType==='content'))dirty=true;});
    ready=true;
    return {map,stats,update,get interacting(){return gesture;},getVehicleLabels:()=>markers?.boxes||[],getRenderMemory:()=>({...webgl.info.memory}),
      setGroundMode(mode){const relief=mode==='terrain';if(relief===terrainState.terrain)return;terrainState.terrain=relief;groundMode=relief?'terrain':'flat';stats.groundMode=groundMode;stats.displayHeight=relief?'DEM + estimated rail levels':'estimated rail levels';map.setTerrain(relief?{source:'terrain',exaggeration:1}:null);map.jumpTo({elevation:0});clearLines();dirty=true;lastBuild=0;stationLayer?.refresh();trees?.schedule();if(frame)update(frame);},
      setFormationMode(mode){formationMode=mode==='three'?'three':'actual';stats.formationMode=formationMode;failed.clear();if(frame)update(frame);},getStations:()=>stationLayer,getStationLabels:()=>stationLabels?.boxes||[],setTrainSizeMode(mode){trainSizeMode=mode==='scale'?'scale':'readable';stats.trainSizeMode=trainSizeMode;},resize:()=>map.resize(),getView:()=>({center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()}),
      setView(v){const c=map.getCenter();if(Math.abs(c.lng-v.center[0])+Math.abs(c.lat-v.center[1])>1e-9||Math.abs(map.getZoom()-v.zoom)>1e-6)map.jumpTo(v);},
      pinnedCameraTarget(){
        if(!frame?.headLocked||!frame.selectedVehicleId)return null;
        const v=frame.vehicles.find(v=>v.id===frame.selectedVehicleId),model=v&&modelFor(formationFor(v,formationMode)),profile=v&&routeProfile(v);if(!profile)return null;
        const direction=profile.direction*(v.formationFacing||1),distance=model?.parts[0]?.offsetM||0,target=profile.path.at(profile.s+direction*distance)||profile.path.at(profile.s);
        const elevation=railHeight(profile.path,target.s);if(!Number.isFinite(elevation))return null;
        stats.followFraming={id:v.id,distanceM:distance,coordinate:target.coordinate,elevation,headLocked:true};
        return {coordinate:target.coordinate,elevation};
      },
      followCoordinate(coord,insets){
        if(gesture){stats.followSuppressed=(stats.followSuppressed||0)+1;return;}
        const w=el.clientWidth,h=el.clientHeight,padding={...insets};
        if(padding.left+padding.right>w-80){const k=(w-80)/(padding.left+padding.right);padding.left*=k;padding.right*=k;}
        if(padding.top+padding.bottom>h-80){const k=(h-80)/(padding.top+padding.bottom);padding.top*=k;padding.bottom*=k;}
        const v=frame?.vehicles.find(v=>v.followed),model=v&&modelFor(formationFor(v,formationMode));
        // 原站相機呼叫早於 draw；用本次傳入的位置求線形與高度，不讀前一幀的車輛里程。
        const profile=v&&(terrainState.terrain||v.route?.level||model?.parts?.length)&&routeProfile({...v,longitude:coord[0],latitude:coord[1],chainageM:null});
        const elevation=profile?.height??height(coord)??0,c=map.getCenter(),p=map.getPadding();
        const pose=frame?.display?.northUp?null:cinematicPose(v);
        const view={id:v?.id,zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing(),formation:model?.key,width:w,height:h};
        if(!ambientWas&&framingView?.id===view.id&&['zoom','pitch','bearing','formation','width','height'].some(k=>view[k]!==framingView[k]))followReturn={id:view.id};
        framingView=view;
        let center=coord,viewElevation=elevation;
        if(profile&&(!terrainState.terrain||profile.path.elevation||profile.path.level)){
          const first=model?.parts[0],headS=profile.s+profile.direction*(first?.offsetM??0),span=Math.min(8,(first?.lengthM??20)*.32),a=profile.path.at(headS-profile.direction*span),b=profile.path.at(headS+profile.direction*span);
          const angle=a&&b?Math.atan2(b.coordinate[1]-a.coordinate[1],(b.coordinate[0]-a.coordinate[0])*Math.cos(coord[1]*Math.PI/180)):profile.angle+(profile.direction<0?Math.PI:0);
          const distance=headFramingDistance(model,{zoom:pose?.zoom??map.getZoom(),pitch:pose?.pitch??map.getPitch(),bearing:pose?.bearing??map.getBearing(),angle,latitude:coord[1],width:w,height:h,padding});
          const target=distance>0&&profile.path.at(profile.s+profile.direction*distance);
          if(target){center=target.coordinate;viewElevation=railHeight(profile.path,target.s);}
          stats.followFraming={id:v.id,distanceM:target?distance:0,coordinate:center,elevation:viewElevation};
        }else stats.followFraming={id:v?.id,distanceM:0,coordinate:center,elevation:viewElevation};
        if(followReturn?.id!==v?.id||!frame?.followLock)followReturn=null;
        if(followReturn){const now=performance.now();
          if(followReturn.at==null)Object.assign(followReturn,{at:now,offset:[c.lng-center[0],c.lat-center[1]],height:map.getCenterElevation()-viewElevation});
          const t=Math.min(1,(now-followReturn.at)/320),remaining=1-t*t*(3-2*t);
          // 只讓手勢結束後的鏡頭偏移收斂；列車仍逐幀畫在班表的原始位置。
          center=[center[0]+followReturn.offset[0]*remaining,center[1]+followReturn.offset[1]*remaining];viewElevation+=followReturn.height*remaining;
          if(t===1)followReturn=null;
        }
        stats.followReturning=!!followReturn;
        if(!pose&&Math.abs(c.lng-center[0])+Math.abs(c.lat-center[1])<1e-9&&Object.keys(padding).every(k=>Math.abs(p[k]-padding[k])<.5)&&Math.abs(map.getCenterElevation()-viewElevation)<.05)return;
        map.setCenterClampedToGround(false);followingCamera=true;try{map.jumpTo({center,elevation:viewElevation,padding,...pose});stats.followMoves=(stats.followMoves||0)+1;}finally{followingCamera=false;}
      },
      togglePitch(){const flat=map.getPitch()>0;map.jumpTo({pitch:flat?0:55});return flat;},
      syncLayerOrder(){orderBuildingPasses(map);},
      setAppearance({buildings,dark,transparent,satellite=false,landscape=false}){dark=dark&&!landscape;terrainState.buildings=buildings;terrainState.stationSolidAppearance=(satellite||landscape)&&!transparent;terrainState.stationInspection=transparent||dark&&!satellite;inspection=transparent;for(const id of ['building-3d','station-building-context'])if(map.getLayer(id)){map.setPaintProperty(id,'fill-extrusion-color',landscape?['interpolate',['linear'],['to-number',['get','render_height'],8],0,'#d3bda0',12,'#e5d7bc',35,'#cad4c9',90,'#b3c9c7']:dark&&!satellite?'#638BC5':'#d4d0c5');map.setPaintProperty(id,'fill-extrusion-opacity',transparent?.24:satellite||landscape?1:dark?.30:.72);map.setLayoutProperty(id,'visibility',buildings?'visible':'none');}stationLayer?.refresh();},
      alignment(){const h=hits.find(h=>h.v.followed);if(!h)return null;let closest=null;for(const a of profileVertices){for(let i=0;i<a.length;i+=6){const dx=a[i+3]-a[i],dy=a[i+4]-a[i+1],d=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((h.p[0]-a[i])*dx+(h.p[1]-a[i+1])*dy)/(d||1))),p=[a[i]+dx*t,a[i+1]+dy*t,a[i+2]+(a[i+5]-a[i+2])*t],horizontal=Math.hypot(p[0]-h.p[0],p[1]-h.p[1]);if(!closest||horizontal<closest.horizontal)closest={horizontal,heightDelta:p[2]-h.p[2],vehicle:project(h.p),rail:project(p),p,train:h.p};}}return closest;},
      projectedRailSamples(){return profileVertices.flatMap(a=>{const out=[];for(let i=0;i<a.length;i+=6)out.push(project([(a[i]+a[i+3])/2,(a[i+1]+a[i+4])/2,(a[i+2]+a[i+5])/2]));return out;});},
      projectedModels(){return [...models].flatMap(([id,m])=>{if(!m.group?.visible)return [];const box=new THREE.Box3().setFromObject(m.group),points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(project([x,y,z]));return [{id,width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))}];});},
      projectedCars(){return [...models].flatMap(([id,m])=>m.group?.visible?m.cars.map((car,index)=>{const mesh=car.children[0],box=mesh.geometry.boundingBox,corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(project(new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).toArray()));return {id,index,center:project(car.position.toArray()),roof:project([car.position.x,car.position.y,car.position.z+2]),scale:car.scale.toArray(),bounds:{left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))}};}):[]);},
      frontScreen(){const m=models.get(frame?.selectedVehicleId);return m?.group?.visible&&(frame?.headLocked||stats.followFraming?.distanceM>0)?project(m.cars[0].position.toArray()):null;},
      hasModel:id=>!!models.get(id)?.group?.visible,
      profileKeys:()=>map.getZoom()>=14?[...(terrainState.terrain?(frame?.routes||[]).filter(r=>!r.physical&&pathFor(r)?.elevation).map(r=>r.lineKey):[]),...(frame?.replacedLineKeys||[])]:[],
      hitTest(point){const out=[];for(const [id,m]of models)if(m.group?.visible){for(const car of m.cars){const mesh=car.children[0],box=mesh.geometry.boundingBox,ps=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=project(new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).toArray());if(p.z>=-1&&p.z<=1)ps.push(p);}if(!ps.length)continue;const left=Math.min(...ps.map(p=>p.x)),right=Math.max(...ps.map(p=>p.x)),top=Math.min(...ps.map(p=>p.y)),bottom=Math.max(...ps.map(p=>p.y));if(point.x>=left-5&&point.x<=right+5&&point.y>=top-7&&point.y<=bottom+7){out.push({id,dist:0,boxed:true});break;}}}return out;},
      projectCoordinate:(coordinate,altitudeM)=>project(world(coordinate,altitudeM)),
      projectedVehicles:()=>hits.map(h=>({id:h.v.id,...project(h.p),coordinate:[h.v.longitude,h.v.latitude]})),destroy};
  }catch(e){destroy();throw e;}
}
