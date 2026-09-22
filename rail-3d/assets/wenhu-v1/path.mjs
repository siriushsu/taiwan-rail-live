// 里程是既有地圖的平面弧長，不以坡度另算一條里程，不把未知高程轉成 0。
const R=6378137,rad=Math.PI/180;
export function localENU(coordinate,origin) {
  return [(coordinate[0]-origin[0])*rad*R*Math.cos(origin[1]*rad),(coordinate[1]-origin[1])*rad*R];
}
export function samplePath(path,s,elevationAt=null) {
  if(!Number.isFinite(s)||s<0||s>path.lengthM)throw RangeError('里程超出交付區段');
  const ds=path.chainageM;let lo=0,hi=ds.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(ds[m]<=s)lo=m;else hi=m;}
  const f=(s-ds[lo])/(ds[hi]-ds[lo]),coordinate=path.coordinates[lo].map((x,k)=>x+(path.coordinates[hi][k]-x)*f);
  const elevations=path.elevation.railElevationM,a=elevations[lo],b=elevations[hi];
  const elevation=elevationAt?elevationAt(s,coordinate):(Number.isFinite(a)&&Number.isFinite(b)?a+(b-a)*f:null);
  if(elevation!==null&&!Number.isFinite(elevation))throw Error('高程需為有限數值或 null');
  return {coordinate,elevationM:elevation,chainageM:s};
}
export function sampleCar(path,s,forwardSign,elevationAt=null,tangentHalfSpanM=1) {
  if(![1,-1].includes(forwardSign))throw Error('方向需為 +1 或 -1');
  if(!Number.isFinite(tangentHalfSpanM)||tangentHalfSpanM<=0)throw Error('切線取樣距離必須為正');
  const p=samplePath(path,s,elevationAt),a=samplePath(path,Math.max(0,s-tangentHalfSpanM),elevationAt),b=samplePath(path,Math.min(path.lengthM,s+tangentHalfSpanM),elevationAt);
  const xy=localENU(b.coordinate,a.coordinate).map(x=>x*forwardSign),horizontal=Math.hypot(...xy);
  const slope=Number.isFinite(a.elevationM)&&Number.isFinite(b.elevationM)?(b.elevationM-a.elevationM)*forwardSign:null;
  const norm=Math.hypot(horizontal,slope??0);
  return {...p,yawRad:Math.atan2(xy[1],xy[0]),pitchRad:slope===null?null:Math.atan2(slope,horizontal),
    forwardENU:slope===null?null:[xy[0]/norm,xy[1]/norm,slope/norm]};
}
export function sampleConsist(path,meta,centerM,direction,formation='short2',elevationAt=null) {
  if(![1,-1].includes(direction))throw Error('行駛方向需為 +1 或 -1');
  const f=meta.formations[formation];if(!f)throw Error('未知編組');
  const cars=f.cars.map(c=>({...c,...sampleCar(path,centerM+c.offsetM,c.forwardAlongPath==='travel-direction'?direction:c.forwardAlongPath,elevationAt)}));
  return {pathId:path.pathId,referenceChainageM:centerM,direction,formation:f.id,leadingCarId:formation==='single'?'A':direction===1?'A':'B',cars};
}
export function placeCarENU(THREE,car,pose,origin) {
  if(pose.elevationM===null||!pose.forwardENU)throw Error('缺少軌道高程；請先提供已確認或明示為測試的高程 profile');
  const x=new THREE.Vector3(...pose.forwardENU),y=new THREE.Vector3(-x.y,x.x,0).normalize(),z=new THREE.Vector3().crossVectors(x,y).normalize();
  car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  const [east,north]=localENU(pose.coordinate,origin);car.position.set(east,north,pose.elevationM);
}
