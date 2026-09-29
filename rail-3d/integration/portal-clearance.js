// 從靜態洞口牆扣出鄰接股道的通道；只切外殼，永遠不移動列車或軌道。
export function portalClearanceVolumes(portals){
 const out=[];
 for(const portal of portals)for(const m of portal.members||[]){
  const samples=m.samples;if(!samples?.length)continue;
  const k=m.scale||1,a=samples[0],next=samples[1]||a,grade=(next[2]-a[2])/(Math.hypot(next[0]-a[0],next[1]-a[1])||1);
  const points=[[a[0]-Math.cos(m.angle)*10*k,a[1]-Math.sin(m.angle)*10*k,a[2]-grade*10*k],...samples];
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.001)continue;
   const tx=dx/len,ty=dy/len,ux=-ty,uy=tx,slope=(b[2]-a[2])/len,wide=2.05*k,below=-.2*k,above=4.8*k;
   const plane=(x,y,z,offset)=>[x,y,z,offset-x*a[0]-y*a[1]-z*a[2]];
   out.push({box:[Math.min(a[0],b[0])-wide,Math.min(a[1],b[1])-wide,Math.min(a[2],b[2])+below,Math.max(a[0],b[0])+wide,Math.max(a[1],b[1])+wide,Math.max(a[2],b[2])+above],
    planes:[plane(tx,ty,0,.02*k),plane(-tx,-ty,0,len+.02*k),plane(ux,uy,0,wide),plane(-ux,-uy,0,wide),plane(-slope*tx,-slope*ty,1,-below),plane(slope*tx,slope*ty,-1,above)]});
  }
 }return out;
}
export function outsidePortalClearance(polygon,volumes){
 let pieces=[polygon];
 for(const {box,planes} of volumes){
  const next=[];
  for(const poly of pieces){
   if([0,1,2].some(i=>poly.every(p=>p[i]<box[i])||poly.every(p=>p[i]>box[i+3]))){next.push(poly);continue;}
   let inside=poly;
   for(const plane of planes){
    if(inside.length<3)break;
    const kept=[],outside=[],value=p=>plane[0]*p[0]+plane[1]*p[1]+plane[2]*p[2]+plane[3];
    for(let i=0;i<inside.length;i++){
     const a=inside[i],b=inside[(i+1)%inside.length],da=value(a),db=value(b),ain=da>=0,bin=db>=0;
     (ain?kept:outside).push(a);
     if(ain!==bin){const t=da/(da-db),p=a.map((v,j)=>v+(b[j]-v)*t);kept.push(p);outside.push(p);}
    }
    if(outside.length>=3)next.push(outside);inside=kept;
   }
  }
  pieces=next;if(!pieces.length)break;
 }return pieces;
}
