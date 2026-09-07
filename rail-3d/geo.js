// 僅供地景示意：固定世界格網讓樹木不因鏡頭移動而重新亂數定位。
export function randomAt(x,y,salt=0){let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(salt+1,1274126177);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
export function inRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function inPolygon(x,y,rings){return inRing(x,y,rings[0])&&!rings.slice(1).some(r=>inRing(x,y,r));}
export function distanceToSegment(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}
export function polygonIndex(features,bounds){
  const cells=new Map(),size=.002;
  for(const f of features){const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];for(const rings of polygons){let w=180,e=-180,s=90,n=-90;for(const [x,y]of rings[0]){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}if(bounds){w=Math.max(w,bounds[0]);s=Math.max(s,bounds[1]);e=Math.min(e,bounds[2]);n=Math.min(n,bounds[3]);}if(w>e||s>n)continue;const item={rings,w,e,s,n};for(let x=Math.floor(w/size);x<=Math.floor(e/size);x++)for(let y=Math.floor(s/size);y<=Math.floor(n/size);y++){const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}}}
  return (x,y)=>(cells.get(Math.floor(x/size)+','+Math.floor(y/size))||[]).some(p=>x>=p.w&&x<=p.e&&y>=p.s&&y<=p.n&&inPolygon(x,y,p.rings));
}
