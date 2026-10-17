// 公尺里程只屬於自己的有序線形；不把分岔路網壓成一條線，也不改來源 XY。
export const EARTH_M=6371000;
export function distanceM(a,b){const r=Math.PI/180,dy=(b[1]-a[1])*r,dx=(b[0]-a[0])*r,s=Math.sin(dy/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dx/2)**2;return 2*EARTH_M*Math.asin(Math.min(1,Math.sqrt(s)));}
export function shapeKey(coordinates){let h=2166136261;for(const c of JSON.stringify(coordinates)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return coordinates.length+'-'+(h>>>0).toString(16);}
export function makePath(coordinates,loop=false){
  const d=[0];for(let i=1;i<coordinates.length;i++)d.push(d.at(-1)+distanceM(coordinates[i-1],coordinates[i]));
  const length=d.at(-1),closed=loop&&distanceM(coordinates[0],coordinates.at(-1))<2;
  function at(s){if(closed)s=((s%length)+length)%length;else if(s<0||s>length)return null;
    let lo=0,hi=d.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(d[mid]<=s)lo=mid;else hi=mid;}const f=(s-d[lo])/(d[hi]-d[lo]||1),a=coordinates[lo],b=coordinates[hi];return {coordinate:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],s,index:lo};}
  let spatial=null;
  function locate(coord,hint){let best=null;const mx=Math.cos(coord[1]*Math.PI/180)*Math.PI/180*EARTH_M,my=Math.PI/180*EARTH_M;
    const visit=i=>{const a=coordinates[i-1],b=coordinates[i],x=(coord[0]-a[0])*mx,y=(coord[1]-a[1])*my,dx=(b[0]-a[0])*mx,dy=(b[1]-a[1])*my,q=dx*dx+dy*dy;if(!q)return;const t=Math.max(0,Math.min(1,(x*dx+y*dy)/q)),error=Math.hypot(x-t*dx,y-t*dy),s=d[i-1]+t*(d[i]-d[i-1]);
      if(!best||error<best.error-.001||(Math.abs(error-best.error)<.001&&Math.abs(s-hint)<Math.abs(best.s-hint)))best={s,error,angle:Math.atan2(dy,dx),index:i-1};};
    // 沒有里程提示的捷運位置，先查鄰近格網。只有能以格網邊界證明
    // 外部線段不會更近（含原本 1mm 平手容差）時才提早返回，否則完整掃描。
    if(!Number.isFinite(hint)&&coordinates.length>64){
      const cell=.004;
      if(!spatial){const grid=new Map(),wide=[];for(let i=1;i<coordinates.length;i++){const a=coordinates[i-1],b=coordinates[i],w=Math.floor(Math.min(a[0],b[0])/cell),e=Math.floor(Math.max(a[0],b[0])/cell),s=Math.floor(Math.min(a[1],b[1])/cell),n=Math.floor(Math.max(a[1],b[1])/cell);if((e-w+1)*(n-s+1)>64){wide.push(i);continue;}for(let x=w;x<=e;x++)for(let y=s;y<=n;y++){const key=x+','+y;let ids=grid.get(key);if(!ids)grid.set(key,ids=[]);ids.push(i);}}spatial={grid,wide};}
      const x=Math.floor(coord[0]/cell),y=Math.floor(coord[1]/cell),ids=new Set(spatial.wide);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of spatial.grid.get((x+dx)+','+(y+dy))||[])ids.add(i);
      for(const i of [...ids].sort((a,b)=>a-b))visit(i);
      const edge=Math.min((coord[0]-(x-1)*cell)*Math.abs(mx),((x+2)*cell-coord[0])*Math.abs(mx),(coord[1]-(y-1)*cell)*my,((y+2)*cell-coord[1])*my);
      if(best&&best.error+.001<edge)return best;
      best=null;
    }
    let first=1;if(Number.isFinite(hint)){let lo=1,hi=d.length;while(lo<hi){const mid=(lo+hi)>>1;if(d[mid]<hint-350)lo=mid+1;else hi=mid;}first=lo;}
    for(let i=first;i<coordinates.length;i++){if(Number.isFinite(hint)&&d[i-1]>hint+350)break;visit(i);}
    return best;
  }
  return {coordinates,d,length,closed,at,locate};
}

// 固定 DEM 取樣的單調三次內插：高度與斜率連續，縮放不重新查圖磚。
export function makeHeightProfile(values,step,length){
  const slopes=values.map((v,i)=>i<values.length-1?(values[i+1]-v)/step:0),m=slopes.map((b,i)=>{if(i===0)return b;if(i===slopes.length-1)return slopes[i-1];const a=slopes[i-1];return a*b<=0?0:2*a*b/(a+b);});
  return s=>{s=Math.max(0,Math.min(length,s));const i=Math.min(values.length-2,Math.floor(s/step)),t=(s-i*step)/step,t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*values[i]+(t3-2*t2+t)*step*m[i]+(-2*t3+3*t2)*values[i+1]+(t3-t2)*step*m[i+1];};
}
export function formationPoses(path,s,direction,parts,elevation=()=>.65){
  const first=parts[0],last=parts.at(-1),front=s+direction*(first.offsetM+first.lengthM/2),back=s+direction*(last.offsetM-last.lengthM/2);
  if(!path.at(front)||!path.at(back))return null; // 未知的接續段不畫直線、也不把車廂堆在端點。
  return parts.map(part=>{const chainage=s+part.offsetM*direction,c=path.at(chainage),half=Math.min(8,part.lengthM*.32),a=path.at(chainage-direction*half),b=path.at(chainage+direction*half),z=elevation(chainage),za=elevation(a.s),zb=elevation(b.s);
    const dx=(b.coordinate[0]-a.coordinate[0])*Math.cos(c.coordinate[1]*Math.PI/180),dy=b.coordinate[1]-a.coordinate[1];return {coordinate:c.coordinate,s:chainage,height:z,angle:Math.atan2(dy,dx),pitch:Math.atan2(zb-za,distanceM(a.coordinate,b.coordinate))};});
}
