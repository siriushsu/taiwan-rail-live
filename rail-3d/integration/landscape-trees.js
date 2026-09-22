// 林冠為 OSM／ESA WorldCover 林地內的示意植被，不宣稱單株位置。只有兩個 instanced draw calls；
// 靜態網格、固定地理種子、相機停下後重建，不隨每幀行車重掃圖磚。
// 大片林地在地景底圖上本來就是整塊綠色，再鋪示意樹只是噪點又吃取樣時間，因此整塊跳過（BROAD_*）。
import {createRailClearance} from './rail-clearance.js';
const MX=101700,MY=111320,STEP=26;
// 「地圖上已經有顏色」的門檻，取自實地量測：大安森林公園與板橋 435 的林地是 ≤1 公頃、最長邊
// ≤280 公尺，台北車站一帶的 ESA 綠塊 ≤6 公頃／≤279 公尺；山區、海岸與縱谷則是中位 20 公頃／
// 638 公尺（阿里山）起跳，到 435–537 公頃（OSM 圖磚整塊）與 19,000 公頃以上（ESA 整片山區）。
// 取 10 公頃／400 公尺：公園、村落與河岸的小片林地照舊長樹，大片綠地整塊不長。
const BROAD_M2=1e5,BROAD_SPAN=400;
function inRing(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
}return yes;}
const inside=(p,rings)=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));
const noise=(x,y)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return (h>>>0)/4294967296;};
export function createLandscapeTrees({map,THREE,scene,world,clearance,getTerrain}){
  const cap=matchMedia('(pointer:coarse)').matches?700:1400;
  const group=new THREE.Group(),dummy=new THREE.Object3D();
  const crownGeometry=new THREE.IcosahedronGeometry(1,0),trunkGeometry=new THREE.CylinderGeometry(.35,.6,1,5);
  // Three 世界的 z 軸向上。
  trunkGeometry.rotateX(Math.PI/2);
  const crownMaterial=new THREE.MeshLambertMaterial({flatShading:true}),trunkMaterial=new THREE.MeshLambertMaterial({color:'#8d7a55'});
  const crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,cap),trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,cap);
  crowns.frustumCulled=trunks.frustumCulled=false;crowns.count=trunks.count=0;group.add(crowns,trunks);scene.add(group);
  let timer=null,disposed=false,building=false,movedAt=0,revision=-1,dirty=true,firstDirty=performance.now();
  const stats={count:0,cap,rebuilds:0,maxBuildMs:0,maxWorkSliceMs:0,yields:0,coordinates:[],checks:0,osmCount:0,worldcoverCount:0,patches:0,broadSkipped:0,error:null};
  const layers=['landcover_wood','landscape-worldcover-wood'];
  const color=new THREE.Color();
  async function rebuild(){
    if(disposed||document.hidden)return;
    if(map.getZoom()<14.5){crowns.count=trunks.count=stats.count=stats.osmCount=stats.worldcoverCount=0;stats.coordinates=[];return;}
    const start=performance.now(),c=map.getCenter(),radius=1000,bounds=map.getBounds(),terrain=getTerrain(),railRevision=clearance.revision;
    let sliceStart=start;
    const measureSlice=()=>{stats.maxWorkSliceMs=Math.max(stats.maxWorkSliceMs,performance.now()-sliceStart);};
    // 取樣與避讓分批讓出主執行緒；最後才一次替換 instance，不讓半成品閃動。
    const stale=()=>disposed||map.isMoving()||getTerrain()!==terrain||clearance.revision!==railRevision||map.getZoom()<14.5||Math.hypot((map.getCenter().lng-c.lng)*MX,(map.getCenter().lat-c.lat)*MY)>300;
    async function yieldWork(){measureSlice();stats.yields++;await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();if(stale()){dirty=true;return false;}return true;}
    const features=map.queryRenderedFeatures({layers:layers.filter(id=>map.getLayer(id))});
    // 面積與最長邊都在門檻內才取樣。整片山林在這裡就被擋掉，後面的障礙物查詢與格點掃描一次都不跑。
    const patches=[];let broad=0;
    for(const f of features)for(const rings of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[]){
      const ring=rings[0];let w=Infinity,e=-Infinity,s=Infinity,n=-Infinity,twice=0;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){const q=ring[i];
        w=Math.min(w,q[0]);e=Math.max(e,q[0]);s=Math.min(s,q[1]);n=Math.max(n,q[1]);
        twice+=ring[j][0]*MX*(q[1]*MY)-q[0]*MX*(ring[j][1]*MY);}
      if(Math.abs(twice)/2>BROAD_M2||Math.max((e-w)*MX,(n-s)*MY)>BROAD_SPAN){broad++;continue;}
      patches.push({rings,w,e,s,n,source:f.source});
    }
    stats.patches=patches.length;stats.broadSkipped=broad;
    if(!patches.length){crowns.count=trunks.count=stats.count=stats.osmCount=stats.worldcoverCount=stats.checks=0;stats.coordinates=[];stats.rebuilds++;
      crowns.instanceMatrix.needsUpdate=trunks.instanceMatrix.needsUpdate=true;stats.maxBuildMs=Math.max(stats.maxBuildMs,performance.now()-start);measureSlice();map.triggerRepaint();return;}
    const obstacles=map.queryRenderedFeatures({layers:['water','building','highway_path','highway_minor','highway_major_inner','landscape-farmland','landscape-farmyard','landscape-grass','landscape-sand','landscape-rock','landscape-industry'].filter(id=>map.getLayer(id))});
    const paths=createRailClearance(),routes=[],blocks=new Map(),cell=.001;
    for(const f of obstacles){
      if(f.geometry.type==='LineString')routes.push({coordinates:f.geometry.coordinates});
      else if(f.geometry.type==='MultiLineString')routes.push(...f.geometry.coordinates.map(coordinates=>({coordinates})));
      else for(const rings of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[]){
        const xs=rings[0].map(p=>p[0]),ys=rings[0].map(p=>p[1]);
        const w=Math.max(Math.min(...xs),c.lng-radius/MX),e=Math.min(Math.max(...xs),c.lng+radius/MX),s=Math.max(Math.min(...ys),c.lat-radius/MY),n=Math.min(Math.max(...ys),c.lat+radius/MY);
        for(let x=Math.floor(w/cell);x<=Math.floor(e/cell);x++)for(let y=Math.floor(s/cell);y<=Math.floor(n/cell);y++){const k=x+','+y;if(!blocks.has(k))blocks.set(k,[]);blocks.get(k).push(rings);}
      }
    }
    paths.update(routes);
    if(!await yieldWork())return;
    const occupied=ring=>ring.some(p=>(blocks.get(Math.floor(p[0]/cell)+','+Math.floor(p[1]/cell))||[]).some(poly=>inside(p,poly)));
    const seen=new Set(),items=[];let checks=0;
    // 相同世界格點在圖磚接縫與縮放前後完全相同，拒絕孔洞和走廊邊界。
    outer:for(const patch of patches){
      const rings=patch.rings;
      const w=Math.max(patch.w,bounds.getWest(),c.lng-radius/MX),e=Math.min(patch.e,bounds.getEast(),c.lng+radius/MX),s=Math.max(patch.s,bounds.getSouth(),c.lat-radius/MY),n=Math.min(patch.n,bounds.getNorth(),c.lat+radius/MY);
      for(let x=Math.floor(w*MX/STEP);x<=Math.ceil(e*MX/STEP);x++)for(let y=Math.floor(s*MY/STEP);y<=Math.ceil(n*MY/STEP);y++){
        if(checks%32===0&&performance.now()-sliceStart>5&&!await yieldWork())return;
        if(++checks>10000)break outer;const key=x+','+y;if(seen.has(key))continue;
        const seed=noise(x,y),p=[(x+.2+seed*.6)*STEP/MX,(y+.2+noise(y,x)*.6)*STEP/MY],r=5+seed*2.8;
        if(p[0]<w||p[0]>e||p[1]<s||p[1]>n||!inside(p,rings))continue;
        const ring=Array.from({length:8},(_,i)=>[p[0]+Math.cos(i*Math.PI/4)*r/MX,p[1]+Math.sin(i*Math.PI/4)*r/MY]);
        if(!ring.every(q=>inside(q,rings))||clearance.blocked([ring],12)||paths.blocked([ring],3)||occupied([p,...ring]))continue;
        let height=0;if(getTerrain()){height=map.queryTerrainElevation(p);if(!Number.isFinite(height))continue;}
        seen.add(key);items.push({p,r,seed,height,source:patch.source,d:Math.hypot((p[0]-c.lng)*MX,(p[1]-c.lat)*MY)});
      }
    }
    items.sort((a,b)=>a.d-b.d);const selected=items.slice(0,cap);
    if(!await yieldWork())return;
    selected.forEach(({p,r,seed,height},i)=>{
      const pos=world(p,height),h=10+seed*7;
      dummy.position.set(pos[0],pos[1],pos[2]+h*.62);dummy.rotation.set(0,0,seed*Math.PI);dummy.scale.set(r,r,h*.47);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);
      color.set(seed<.33?'#729863':seed<.66?'#86a771':'#618b64');crowns.setColorAt(i,color);
      dummy.position.set(pos[0],pos[1],pos[2]+h*.22);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,h*.44);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    });
    crowns.count=trunks.count=stats.count=selected.length;crowns.instanceMatrix.needsUpdate=trunks.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;
    stats.worldcoverCount=selected.filter(item=>item.source==='taiwan-worldcover').length;stats.osmCount=selected.length-stats.worldcoverCount;
    stats.coordinates=selected.map(({p})=>p);stats.checks=checks;stats.rebuilds++;stats.maxBuildMs=Math.max(stats.maxBuildMs,performance.now()-start);measureSlice();map.triggerRepaint();
  }
  function settle(){timer=null;if(disposed)return;
    if(document.hidden){return;}
    if(map.isMoving()||(performance.now()-movedAt<450&&performance.now()-firstDirty<15000)){timer=setTimeout(settle,450);return;}
    if(building){timer=setTimeout(settle,480);return;}
    if(dirty){dirty=false;building=true;rebuild().catch(e=>{stats.error=String(e);}).finally(()=>{building=false;if(dirty&&!disposed)schedule();});}
  }
  function schedule(e){if(disposed||e?.sourceId&&!['openmaptiles','terrain','taiwan-worldcover'].includes(e.sourceId))return;if(e?.sourceId&&!e.tile&&e.sourceDataType!=='content')return;
    if(!dirty){dirty=true;firstDirty=performance.now();}if(!timer)timer=setTimeout(settle,480);
  }
  function move(){movedAt=performance.now();group.visible=map.getZoom()>=14.5;schedule();}
  function visibility(){if(!document.hidden)schedule();}
  map.on('move',move);map.on('sourcedata',schedule);document.addEventListener('visibilitychange',visibility);schedule();
  return {group,stats,schedule,refresh(){if(revision!==clearance.revision){revision=clearance.revision;schedule();}},destroy(){if(disposed)return;disposed=true;clearTimeout(timer);map.off('move',move);map.off('sourcedata',schedule);document.removeEventListener('visibilitychange',visibility);scene.remove(group);crowns.dispose();trunks.dispose();crownGeometry.dispose();trunkGeometry.dispose();crownMaterial.dispose();trunkMaterial.dispose();stats.count=0;}};
}
