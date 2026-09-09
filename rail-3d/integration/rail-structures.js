// 沿既有軌面補示意橋梁／路基，不改列車 XY 或高程。尺寸與橋墩間距不是實測工程資料。
import * as THREE from '../vendor/three.module.js';
export function createRailStructures(scene){
  let geometry=new THREE.BufferGeometry();
  const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.renderOrder=-1;scene.add(mesh);
  const stats={decks:0,piers:0,beds:0,vertices:0,samples:[],buildMs:0};
  function set(segments,piers){
    const started=performance.now(),positions=[],colors=[],deck=new THREE.Color('#b2ad9e'),side=new THREE.Color('#989588'),earth=new THREE.Color('#afa48a');
    stats.decks=stats.piers=stats.beds=0;stats.samples=[];
    function quad(a,b,c,d,color){for(const p of [a,b,c,a,c,d]){positions.push(...p);colors.push(color.r,color.g,color.b);}}
    function prism(a,b,width,bottomA,bottomB,color){
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-5)return;
      const nx=-dy/length*width/2,ny=dx/length*width/2;
      const p=[[a[0]+nx,a[1]+ny,a[2]],[a[0]-nx,a[1]-ny,a[2]],[b[0]-nx,b[1]-ny,b[2]],[b[0]+nx,b[1]+ny,b[2]]],q=p.map((v,i)=>[v[0],v[1],i<2?bottomA:bottomB]);
      quad(...p,color);quad(q[3],q[2],q[1],q[0],side);for(let i=0;i<4;i++){const j=(i+1)%4;quad(p[i],q[i],q[j],p[j],color===earth?earth:side);}
    }
    for(const {a,b,groundA,groundB,bridge,transition=false,scale=1} of segments){
      const topA=[a[0],a[1],a[2]-.35*scale],topB=[b[0],b[1],b[2]-.35*scale];
      if(![...a,...b,groundA,groundB,scale].every(Number.isFinite)||Math.min(topA[2]-groundA,topB[2]-groundB)<.05*scale)continue;
      if(bridge){prism(topA,topB,4.2*scale,Math.max(groundA-.3*scale,topA[2]-1.15*scale),Math.max(groundB-.3*scale,topB[2]-1.15*scale),deck);stats.decks++;}
      else{prism(topA,topB,4.2*scale,transition?Math.max(groundA-.3*scale,topA[2]-1.15*scale):groundA-.3*scale,transition?Math.max(groundB-.3*scale,topB[2]-1.15*scale):groundB-.3*scale,earth);stats.beds++;}
    }
    for(const {p,ground,angle,scale=1,coordinate,railHeightM,groundM}of piers){
      const top=p[2]-1.5*scale;if(![...p,ground,angle,scale].every(Number.isFinite)||top-ground<.3*scale)continue;
      const dx=Math.cos(angle)*.8*scale,dy=Math.sin(angle)*.8*scale;
      prism([p[0]-dx,p[1]-dy,top],[p[0]+dx,p[1]+dy,top],1.8*scale,ground-.5*scale,ground-.5*scale,deck);stats.piers++;
      if(stats.samples.length<60)stats.samples.push({coordinate,railHeightM,groundM,topM:railHeightM-1.5,baseM:groundM-.5});
    }
    geometry.dispose();geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();mesh.geometry=geometry;stats.vertices=positions.length/3;stats.buildMs=performance.now()-started;
  }
  return {stats,set,setVisible(visible){mesh.visible=visible;},destroy(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
