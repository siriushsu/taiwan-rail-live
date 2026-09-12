import * as THREE from '../vendor/three.module.js';
import {createRoutes} from './alishan-route.js';
export const THEMES={day:{background:'#e8e9de',sun:'#fff0ca',ambient:'#c2d5d0',ground:'#65795c',power:2.8,exposure:1.02},sunset:{background:'#e7d8c4',sun:'#ffbf80',ambient:'#c7bdb9',ground:'#657160',power:2.8,exposure:.93},night:{background:'#182d32',sun:'#b4cfdd',ambient:'#758f96',ground:'#304c3c',power:.8,exposure:.8}};
export function createScene(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set(),routes=createRoutes();
 let seed=4910;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stone=geo(new THREE.IcosahedronGeometry(1,1)),wood=mat('#75624d'),wall=mat('#ac9672'),roof=mat('#594e43'),steel=mat('#888e83',{metalness:.55,roughness:.4}),ballast=mat('#8e8b77'),leaf=mat('#3c6553'),leaf2=mat('#597863'),leaf3=mat('#789272'),moss=mat('#7f9573');
 const batches=new Map(),dummy=new THREE.Object3D();
 function instance(g,m,pos,scale,rot=[0,0,0]){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot});}
 const block=(m,size,pos,rot)=>instance(box,m,pos,size,rot);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}
 mesh(geo(new THREE.ExtrudeGeometry(rounded(72,50,4.5),{depth:1,bevelEnabled:true,bevelSize:.25,bevelThickness:.15,bevelSegments:2,curveSegments:16})),mat('#a28b68'),[0,0,-2.6]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(72.4,50.4,4.6),{depth:.2,bevelEnabled:false,curveSegments:16})),mat('#594d3e'),[0,0,-2.85]);
 // 場景只生成一次最近軌道索引；地表在路基內回到同一條軌道高程，留 .2 的道床厚度。
 const railPoints=routes.flatMap(r=>r.points);
 function nearRail(x,y){let distance=Infinity,z=0;for(const p of railPoints){const d=(p.x-x)**2+(p.y-y)**2;if(d<distance){distance=d;z=p.z;}}return{distance:Math.sqrt(distance),z};}
 function groundHeight(x,y){const near=nearRail(x,y);let natural=Math.max(.25,1+(y+14)*.38)+6*Math.exp(-(((x-3)/14)**2+((y-18)/8)**2))+3*Math.exp(-(((x+21)/8)**2+((y+2)/7)**2));const t=THREE.MathUtils.smoothstep(near.distance,1.35,3.4);let h=THREE.MathUtils.lerp(near.z-.2,natural,t);for(const [cx,cy,z]of [[-23,-10.9,1],[23,18.2,12]]){const d=Math.max(Math.abs(x-cx)-4.3,Math.abs(y-cy)-2.5,0);h=THREE.MathUtils.lerp(z-.2,h,THREE.MathUtils.smoothstep(d,0,1));}return h;}
 const nx=120,ny=80,positions=[],colors=[],indices=[],boundary=[],grass=new THREE.Color('#879773'),dark=new THREE.Color('#5d7960');
 const rowExtent=y=>Math.abs(y)<=19?35:31+Math.sqrt(Math.max(0,16-(Math.abs(y)-19)**2));
 for(let j=0;j<=ny;j++){const y=-23+j/ny*46,extent=rowExtent(y);for(let i=0;i<=nx;i++){const x=-extent+i/nx*extent*2,z=groundHeight(x,y);positions.push(x,y,z);const c=grass.clone().lerp(dark,Math.min(.7,z/30)).multiplyScalar(.97+rand()*.06);colors.push(c.r,c.g,c.b);}}
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*(nx+1)+i;indices.push(k,k+1,k+nx+1,k+1,k+nx+2,k+nx+1);}
 const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();const terrain=mesh(g,mat('#ffffff',{vertexColors:true}));
 for(let i=0;i<=nx;i++)boundary.push(i);for(let j=1;j<=ny;j++)boundary.push(j*(nx+1)+nx);for(let i=nx-1;i>=0;i--)boundary.push(ny*(nx+1)+i);for(let j=ny-1;j>0;j--)boundary.push(j*(nx+1));
 const side=[],si=[],sc=[],earth=new THREE.Color('#968670'),bed=new THREE.Color('#b3a487');for(const k of [...boundary,boundary[0]]){const x=positions[k*3],y=positions[k*3+1],z=positions[k*3+2];side.push(x,y,z,x,y,-1.6);sc.push(earth.r,earth.g,earth.b,bed.r,bed.g,bed.b);}for(let i=0;i<boundary.length;i++){const k=i*2;si.push(k,k+2,k+1,k+1,k+2,k+3);}const sg=geo(new THREE.BufferGeometry());sg.setAttribute('position',new THREE.Float32BufferAttribute(side,3));sg.setAttribute('color',new THREE.Float32BufferAttribute(sc,3));sg.setIndex(si);sg.computeVertexNormals();const skirt=mesh(sg,mat('#ffffff',{vertexColors:true,side:THREE.DoubleSide}));skirt.castShadow=false;
 // 軌道含 Z 高程；共享留置線只畫一次，避免深度重疊。
 const seen=new Set(),ties=new Set();
 for(const [routeIndex,path] of routes.entries()){const runs=[];for(let s=0;s<path.length;s+=.25){const a=path.sample(s),b=path.sample(Math.min(path.length,s+.25));if((routeIndex===1&&a.x>=12)||(routeIndex===2&&b.x<=-12))continue;const key=[a.x,a.y,a.z].map(n=>Math.round(n*20)).join(',');if(seen.has(key))continue;seen.add(key);runs.push([a,b]);}
  for(const [offset,width,z,m]of [[0,1.92,-.10,ballast],[-.48,.075,0,steel],[.48,.075,0,steel]]){const v=[],idx=[];for(const [a,b]of runs){const k=v.length/3;for(const p of [a,b])for(const sign of [-1,1])v.push(p.x-Math.sin(p.heading)*(offset+sign*width/2),p.y+Math.cos(p.heading)*(offset+sign*width/2),p.z+z);idx.push(k,k+2,k+1,k+1,k+2,k+3);}const r=geo(new THREE.BufferGeometry());r.setAttribute('position',new THREE.Float32BufferAttribute(v,3));r.setIndex(idx);r.computeVertexNormals();mesh(r,m);}
  for(let s=0;s<=path.length;s+=.43){const p=path.sample(s);if((routeIndex===1&&p.x>=12)||(routeIndex===2&&p.x<=-12))continue;const key=[p.x,p.y,p.z].map(n=>Math.round(n*2)).join(',');if(ties.has(key))continue;ties.add(key);const a=path.sample(s+.1),b=path.sample(s-.1),pitch=Math.atan2(a.z-b.z,Math.hypot(a.x-b.x,a.y-b.y));instance(box,wood,[p.x,p.y,p.z-.07],[.16,1.55,.10],[0,-pitch,p.heading]);}
 }
 // 針葉樹使用不規則的多層樹冠與高樹幹，前方留空，保留列車辨識度。
 const crown=geo(new THREE.ConeGeometry(1,1,7));crown.rotateX(Math.PI/2);const trunkGeo=geo(new THREE.CylinderGeometry(.11,.17,1,7));trunkGeo.rotateX(Math.PI/2);
 for(let i=0;i<330;i++){const x=rand()*63-31.5,y=rand()*40-19,near=nearRail(x,y);if((y<-9&&x<10)||near.distance<2.8||((x<-15&&y<-10)||(x>15&&y>12)))continue;const z=groundHeight(x,y),h=3.4+rand()*4.8,r=.65+rand()*.8;instance(trunkGeo,wood,[x,y,z+h*.38],[1,1,h*.76]);for(let j=0;j<4;j++){const k=1-j*.19;instance(crown,[leaf,leaf2,leaf3][i%3],[x,y,z+h*(.48+j*.14)],[r*k,r*k,h*.40],[0,0,rand()]);}}
 for(let i=0;i<140;i++){const x=rand()*64-32,y=rand()*41-20;if(nearRail(x,y).distance<1.45)continue;const s=.2+rand()*.4;instance(stone,moss,[x,y,groundHeight(x,y)+s*.3],[s*1.4,s,s*.7]);}
 const glass=mat('#819b8c',{emissive:'#ffd69b',emissiveIntensity:0}),lamp=mat('#efd09b',{emissive:'#ffd294',emissiveIntensity:.08}),pointLights=[];
 function station(x,y,z,size){
  block(wall,[size+3,1.4,.48],[x,y-1.6,z+.03]);block(mat('#c3b38d'),[size+3.2,1.55,.1],[x,y-1.6,z+.29]);
  block(wall,[size,2.15,1.8],[x,y,z+.9]);for(let k=-size/2+.3;k<size/2;k+=.45)block(wood,[.045,.06,1.7],[x+k,y-1.10,z+.88]);
  const rs=new THREE.Shape();rs.moveTo(-1.45,0);rs.lineTo(0,.95);rs.lineTo(1.45,0);rs.closePath();const rg=geo(new THREE.ExtrudeGeometry(rs,{depth:size+.7,bevelEnabled:false}));rg.rotateX(Math.PI/2);rg.rotateZ(Math.PI/2);mesh(rg,roof,[x-size/2-.35,y,z+1.8]);
  for(const k of [-1,1])block(glass,[.85,.065,.78],[x+k*size*.23,y-1.13,z+1.02]);
  block(roof,[.73,.09,1.3],[x,y-1.16,z+.68]);
  for(const dx of [-size/2-1,size/2+1]){block(wood,[.12,.12,2.8],[x+dx,y-1.5,z+1.4]);block(lamp,[.4,.3,.15],[x+dx,y-1.5,z+2.7]);const l=new THREE.PointLight('#ffd294',0,6,2);l.position.set(x+dx,y-1.8,z+2.5);group.add(l);pointLights.push(l);}
 }
 station(-23,-10.9,1,5.3);station(23,18.2,12,4.7);
 // 折返端擋車器與轉轍標誌；留置線長度依完整編組驗算。
 const red=mat('#a75240'),sign=mat('#e6d9b6');for(const [x,y,z]of [[30.4,-5,4],[-30.4,6,8],[-30.4,-14,1],[30.4,15,12]]){block(wood,[.2,1.4,.65],[x,y,z+.28]);block(red,[.3,1.55,.18],[x,y,z+.60]);}
 for(const [x,y,z]of [[12,-3.6,4],[-12,7.4,8]]){block(wood,[.1,.1,1.15],[x,y,z+.4]);block(sign,[.65,.12,.55],[x,y,z+1]);block(red,[.17,.14,.4],[x,y,z+1]);}
 // 林間步道與枕木色欄杆，讓月台融入山坡。
 for(let i=0;i<10;i++){const x=-18+i*.42,y=-8.9,z=groundHeight(x,y);block(wood,[.36,1.2,.12],[x,y,z+.05]);}
 for(const [geometry,byMaterial]of batches)for(const [material,items]of byMaterial){const o=new THREE.InstancedMesh(geometry,material,items.length);items.forEach((p,i)=>{dummy.position.set(...p.pos);dummy.rotation.set(...p.rot,'ZYX');dummy.scale.set(...p.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.castShadow=o.receiveShadow=true;group.add(o);}
 const ray=new THREE.Raycaster();
 return{surfaceHeight(x,y){group.updateMatrixWorld(true);ray.set(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1));return ray.intersectObject(terrain)[0]?.point.z;},group,routes,label:'阿里山林鐵',groundHeight,nearRail,themes:THEMES,camera:{yaw:-1.35,elevation:.65},update(time,period){glass.emissiveIntensity=period==='night'?1.1:period==='sunset'?.25:0;lamp.emissiveIntensity=period==='night'?2:.08;pointLights.forEach(l=>l.intensity=period==='night'?5:0);},dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
