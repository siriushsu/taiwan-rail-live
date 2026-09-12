// 微縮 Y 型道岔；共用岔枕、外側基本軌、可動尖軌與轍叉。非特定實站工程圖。
const specs=[{x:12,y:-5,z:4,dir:-1,routes:[0,1]},{x:-12,y:6,z:8,dir:1,routes:[1,2]}];
export function turnoutAt(x,y,pad=0){return specs.some(s=>{const d=(x-s.x)*s.dir;return d>=-.3-pad&&d<=7.15+pad&&Math.abs(y-s.y)<3+pad;});}
export function createTurnouts({THREE,group,routes,geo,mesh,block,wood,steel,ballast,mat}){
 const iron=mat('#424b47',{metalness:.6,roughness:.48}),ivory=mat('#ede4c8'),red=mat('#b94c38');
 function sampleX(route,x){let lo=0,hi=route.length;for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(route.sample(mid).x<x)lo=mid;else hi=mid;}return route.sample((lo+hi)/2);}
 function bar(a,b,width,height,material){const dx=b.x-a.x,dy=b.y-a.y;block(material,[Math.hypot(dx,dy),width,height],[(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2-height/2],[0,0,Math.atan2(dy,dx)]);}
 const items=specs.map((spec,id)=>{
  const {x,y,z,dir}=spec;
  const point=(branch,d,inner=false)=>{const p=sampleX(routes[spec.routes[branch]],x+dir*d),side=(branch===0?-1:1)*(inner?-1:1);return{x:p.x-Math.sin(p.heading)*side*.48,y:p.y+Math.cos(p.heading)*side*.48,z};};
  // 岔床與加長岔枕共用一份；各股道不再把枕木交錯疊上去。
  for(let d=-.25;d<7.15;d+=.2){const a=point(0,d),b=point(1,d);block(ballast,[.205,b.y-a.y+1.05,.14],[x+dir*d,(a.y+b.y)/2,z-.17]);}
  for(let d=0;d<7.15;d+=.43){const a=point(0,d),b=point(1,d);block(wood,[.16,b.y-a.y+.7,.1],[x+dir*d,(a.y+b.y)/2,z-.075]);}
  // 基本軌從共用軌連續分岔；轍叉留輪緣槽，避免兩根鋼軌直接穿透。
  let frog=0,best=Infinity;for(let d=3;d<7.15;d+=.01){const gap=Math.abs(point(0,d,true).y-point(1,d,true).y);if(gap<best){best=gap;frog=d;}}
  for(const branch of [0,1]){
   for(let d=-.25;d<7.15;d+=.1)bar(point(branch,d),point(branch,Math.min(7.15,d+.1)),.075,.075,steel);
   for(let d=3.2;d<7.15;d+=.075){if(Math.abs(d-frog)<.12)continue;bar(point(branch,d,true),point(branch,Math.min(7.15,d+.075),true),.065,.075,steel);}
   // 外軌旁的護軌；兩端向股道內收，保留輪緣槽。
   for(let d=frog-.7;d<frog+.7;d+=.1){const a=point(branch,d),b=point(branch,d+.1),inset=(branch===0?1:-1)*.16;a.y+=inset;b.y+=inset;bar(a,b,.05,.065,iron);}
  }
  const frogPoint=point(0,frog,true);block(iron,[.18,.13,.065],[frogPoint.x,frogPoint.y,z-.04]);
  const tongues=[0,1].map(branch=>{
   const geometry=geo(new THREE.BufferGeometry()),positions=new Float32Array(28*8*3),indices=[];
   for(let i=0;i<28;i++){const k=i*8;for(const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[2,6,7,3],[1,5,6,2],[3,7,4,0]]){const [a,b,c,d]=face;indices.push(k+a,k+b,k+c,k+a,k+c,k+d);}}
   if(dir<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
   geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);
   const object=mesh(geometry,steel);object.name=`turnout-${id}-tongue-${branch}`;object.frustumCulled=false;
   function update(open){for(let i=0;i<28;i++){
    for(let end=0;end<2;end++){const d=.3+(i+end)/28*2.9,p=point(branch,d,true),t=(d-.3)/2.9;
     p.y+=(branch===0?-1:1)*open*.17*(1-t);const width=.014+.05*t;
     for(let j=0;j<4;j++){const index=(i*8+end*4+j)*3;positions[index]=p.x;positions[index+1]=p.y+(j===0||j===3?-1:1)*width/2;positions[index+2]=z+(j<2?0:-.07);}
    }
   }geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();}
   return{update};
  });
  // 連桿、扳柄及雙面指示牌跟同一個轉轍進度，避免牌已轉但尖軌未到位。
  const mechanism=new THREE.Group();mechanism.position.set(x+dir*.8,y+1.8,z);group.add(mechanism);
  function part(material,size,pos,parent=mechanism){const m=new THREE.Mesh(geo(new THREE.BoxGeometry(...size)),material);m.position.set(...pos);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
  part(iron,[.65,.55,.18],[0,0,-.03]);part(iron,[.1,.1,1.25],[0,0,.6]);
  const indicator=new THREE.Group();indicator.position.z=1.25;mechanism.add(indicator);
  part(ivory,[.65,.1,.46],[0,0,0],indicator);part(red,[.39,.12,.12],[0,0,0],indicator);
  part(red,[.15,.13,.27],[.17,0,0],indicator);
  const lever=part(iron,[.08,.08,.65],[0,.23,.33]);
  const rod=part(iron,[.08,2.05,.055],[0,-1.03,-.02]);
  let value=-1;
  return{update(position){if(position===value)return;value=position;tongues[0].update(position);tongues[1].update(1-position);indicator.rotation.z=position*Math.PI/2;lever.rotation.x=(position-.5)*1.5;rod.position.y=-1.03+(position-.5)*.17;},get details(){return{id,position:value,indicatorAngle:indicator.rotation.z,bladeOpenings:[value*.17,(1-value)*.17],toe:[x,y,z],frogDistance:frog};}};
 });
 let state=[];
 return{update(states){state=states.map((s,i)=>{items[i].update(s.position);return{...s,...items[i].details};});},get state(){return state;}};
}
