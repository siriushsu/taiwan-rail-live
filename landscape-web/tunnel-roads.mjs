// 圖磚可能含同時跨橋、穿隧道和走地面的單一道路，依原路的累計里程取出地表段。
function keyOf(road) {
  let h = 2166136261;
  for (const point of road.pts) for (let i=0;i<2;i++) {
    h = Math.imul(h ^ Math.round(point[i]*100),16777619);
  }
  return road.cls + ':' + (h>>>0);
}
export function surfaceRoads(roads, detail) {
  if (!detail?.cuts) return roads;
  return roads.flatMap(road => {
    const cuts = detail.cuts[keyOf(road)];
    if (!cuts) return [road];
    const pts = road.pts, distances = [0];
    for (let i=1;i<pts.length;i++) distances.push(distances[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    const end = distances.at(-1);
    function pointAt(s) {
      const i = distances.findIndex(d=>d>=s);
      if (i<0) return pts.at(-1);
      if (!i || distances[i]===s) return pts[i];
      const a=pts[i-1],b=pts[i], f=(s-distances[i-1])/(distances[i]-distances[i-1]);
      return Array.from({length:Math.max(a.length,b.length)}, (_,k)=>{
        const av=a[k]??(k===3?road.w:0), bv=b[k]??(k===3?road.w:0);
        return av+(bv-av)*f;
      });
    }
    const parts=[];
    function keep(a,b) {
      if (b-a<.05) return;
      const part={...road,pts:[pointAt(a),...pts.filter((p,i)=>distances[i]>a && distances[i]<b),pointAt(b)]};
      if (road.edgeSkip) part.edgeSkip=road.edgeSkip.filter(([,from,to])=>from<b && to>a)
        .map(([side,from,to])=>[side,Math.max(from,a)-a,Math.min(to,b)-a]);
      parts.push(part);
    }
    let cursor=0;
    for (const [a,b] of cuts) {
      keep(cursor,Math.min(a,end));
      cursor=Math.max(cursor,b);
    }
    keep(cursor,end);
    return parts;
  });
}

export function withTunnelTrees(buffer, trees, fraction=1) {
  const nativeBytes=Math.floor(buffer.byteLength/10*fraction)*10;
  const restoredCount=Math.floor((trees?.length||0)*fraction);
  if (!restoredCount) return new DataView(buffer,0,nativeBytes);
  const grown=new Uint8Array(nativeBytes+restoredCount*10);
  grown.set(new Uint8Array(buffer,0,nativeBytes));
  const view=new DataView(grown.buffer);
  for(let i=0;i<restoredCount;i++) {
    const [x,y,...appearance]=trees[i];
    const o=nativeBytes+i*10;
    view.setUint16(o,x,true);view.setUint16(o+2,y,true);grown.set(appearance,o+4);
  }
  return view;
}
