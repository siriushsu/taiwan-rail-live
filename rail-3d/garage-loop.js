// 同一條閉合路徑同時生成軌道與編組位置，避免彎道和車體使用不同曲線。
import * as THREE from './vendor/three.module.js';

export function createLoop(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set(),half=5,radius=7,outer=8.65,length=half*4+Math.PI*radius*2;
 const geometry=g=>(geometries.add(g),g),material=(color,roughness=.86)=>{const m=new THREE.MeshStandardMaterial({color,roughness});materials.add(m);return m;};
 const turf=material('#92ac76'),edge=material('#d5c8a9'),ballast=material('#7e8279'),wood=material('#776e5a'),steel=material('#c0c5c2',.3);
 const cream=material('#e8dfc5'),roof=material('#56746c'),glass=material('#537880',.28),trunk=material('#8b7155'),foliage=material('#668758'),leaves=material('#83a369');
 const box=geometry(new THREE.BoxGeometry(1,1,1));
 function block(mat,size,pos){const m=new THREE.Mesh(box,mat);m.scale.set(...size);m.position.set(...pos);group.add(m);return m;}
 function sample(s){
  let q=((half-s)%length+length)%length,x,y,heading;
  if(q<half*2){x=-half+q;y=-radius;heading=0;}
  else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=radius*Math.sin(a);heading=a+Math.PI/2;}
  else if((q-=Math.PI*radius)<half*2){x=half-q;y=radius;heading=Math.PI;}
  else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=radius*Math.sin(a);heading=a+Math.PI/2;}
  return{x,y,heading:heading+Math.PI};
 }
 function capsule(r){const s=new THREE.Shape();s.moveTo(-half,-r);s.lineTo(half,-r);s.absarc(half,0,r,-Math.PI/2,Math.PI/2,false);s.lineTo(-half,r);s.absarc(-half,0,r,Math.PI/2,Math.PI*1.5,false);return s;}
 const plinth=new THREE.Mesh(geometry(new THREE.ExtrudeGeometry(capsule(outer),{depth:.43,bevelEnabled:true,bevelSize:.14,bevelThickness:.12,bevelSegments:3,curveSegments:64})),edge);plinth.position.z=-.64;group.add(plinth);
 const lawn=new THREE.Mesh(geometry(new THREE.ShapeGeometry(capsule(outer-.1),64)),turf);lawn.position.z=-.07;group.add(lawn);
 function ribbon(offset,width,z,mat){
  const positions=[],indices=[],count=384;
  for(let i=0;i<=count;i++){const p=sample(i/count*length),nx=-Math.sin(p.heading),ny=Math.cos(p.heading);for(const side of [-1,1])positions.push(p.x+nx*(offset+side*width/2),p.y+ny*(offset+side*width/2),z);if(i<count){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
  const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const mesh=new THREE.Mesh(g,mat);group.add(mesh);return mesh;
 }
 // 道床、枕木、兩根鋼軌依同一中心線取樣。
 ribbon(0,2.04,-.035,ballast);ribbon(-.54,.085,.18,steel);ribbon(.54,.085,.18,steel);
 const sleepers=new THREE.InstancedMesh(box,wood,Math.ceil(length/.36)),dummy=new THREE.Object3D();
 for(let i=0;i<sleepers.count;i++){const p=sample(i/sleepers.count*length);dummy.position.set(p.x,p.y,.045);dummy.rotation.set(0,0,p.heading);dummy.scale.set(.16,1.65,.12);dummy.updateMatrix();sleepers.setMatrixAt(i,dummy.matrix);}group.add(sleepers);
 const gravelMat=material('#a5a697'),gravel=new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(1,0)),gravelMat,700);
 for(let i=0;i<gravel.count;i++){const p=sample(i/gravel.count*length),side=i%2?1:-1,offset=side*(.84+.13*Math.sin(i*13.7));dummy.position.set(p.x-Math.sin(p.heading)*offset,p.y+Math.cos(p.heading)*offset,.008);dummy.rotation.set(i,i*.7,i*.3);dummy.scale.set(.04,.06,.045);dummy.updateMatrix();gravel.setMatrixAt(i,dummy.matrix);}group.add(gravel);
 // 中央的小站與樹叢留在淨空外，不遮住前景的三節小車。
 block(cream,[8,1.45,.25],[0,-5.1,.045]);block(edge,[8,.12,.05],[0,-5.74,.20]);
 block(cream,[3.4,1.6,1.3],[0,-3.6,.58]);block(roof,[3.9,2,.19],[0,-3.6,1.36]);
 for(const x of [-1.05,1.05])block(glass,[.62,.035,.52],[x,-4.42,.72]);block(roof,[.54,.05,.94],[0,-4.44,.39]);
 for(const x of [-3.25,3.25]){block(wood,[1,.30,.13],[x,-4.95,.55]);for(const dx of [-.34,.34])block(roof,[.075,.20,.35],[x+dx,-4.95,.32]);}
 const crown=geometry(new THREE.IcosahedronGeometry(1,2)),stem=geometry(new THREE.CylinderGeometry(.1,.15,1.3,7));stem.rotateX(Math.PI/2);
 for(const [i,x,y,s]of [[0,-5,1.8,1],[1,-3.4,2.7,.8],[2,4.4,2.2,1.05],[3,6.1,.9,.72]]){
  const t=new THREE.Mesh(stem,trunk);t.position.set(x,y,.55);t.scale.setScalar(s);group.add(t);
  for(const [dx,dy,dz,k]of [[0,0,1.9,1],[-.38,.1,1.6,.72],[.4,-.2,1.7,.66]]){const c=new THREE.Mesh(crown,i%2?leaves:foliage);c.position.set(x+dx*s,y+dy*s,dz*s);c.scale.set(.78*s*k,.72*s*k,.91*s*k);group.add(c);}
 }
 // 柔和接地陰影只由幾何構成，避免另開高成本的陰影貼圖。
 const shade=new THREE.MeshBasicMaterial({color:'#44503b',transparent:true,opacity:.13,depthWrite:false});materials.add(shade);
 for(const [x,y,s]of [[-5,1.8,1],[4.4,2.2,1.1],[0,-3.6,1.9]]){const m=new THREE.Mesh(geometry(new THREE.CircleGeometry(1,40)),shade);m.position.set(x+.3,y+.2,-.065);m.scale.set(s*1.25,s*.8,1);group.add(m);}
 return{group,sample,length,half,radius,outer,dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
