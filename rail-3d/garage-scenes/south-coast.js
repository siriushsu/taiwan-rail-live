// 南迴海岸的微縮印象；不是特定車站或實際線形的重建。沿線物件由固定 seed 生成。
import * as THREE from '../vendor/three.module.js';
export const THEMES = {
 day:{background:'#eae7dd',sun:'#fff1cf',ambient:'#c1dce7',ground:'#7b8663',power:3.2,exposure:1.05,water:'#307c8c',shallow:'#71b3ae'},
 sunset:{background:'#e9d6c3',sun:'#ffbc77',ambient:'#d5b7b2',ground:'#6c7161',power:3.1,exposure:.95,water:'#547f89',shallow:'#9db5a4'},
 night:{background:'#172c38',sun:'#a4c8eb',ambient:'#69839d',ground:'#2d3b40',power:.7,exposure:.78,water:'#193e55',shallow:'#3b6975'}
};
export function createScene(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=9184; const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,more={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...more});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stoneGeo=geo(new THREE.IcosahedronGeometry(1,0));
 const grass=mat('#809475'),rock=mat('#879081'),sand=mat('#c1bb9f'),gravel=mat('#a69c84'),wood=mat('#5b4c3a'),steel=mat('#8a9291',{metalness:.65,roughness:.35}),cream=mat('#e9dfc3'),roof=mat('#557f7b'),red=mat('#a45c46'),trunk=mat('#71664e');
 const lamp=mat('#f6d797',{emissive:'#ffc879',emissiveIntensity:.08});
 const windows=mat('#718e8a',{metalness:.15,roughness:.25,emissive:'#ffc47e',emissiveIntensity:0});
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=true;o.receiveShadow=true;group.add(o);return o;}
 function block(m,size,pos){const o=mesh(box,m,pos);o.scale.set(...size);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}
 const outline=rounded(66,40,4);
 mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
 const waterMat=mat(THEMES.day.water,{roughness:.35,metalness:.12});
 const water=mesh(geo(new THREE.ShapeGeometry(outline,24)),waterMat,[0,0,-.61]);water.castShadow=false;
 waterMat.onBeforeCompile=s=>{s.uniforms.coastTime={value:0};s.uniforms.shallow={value:new THREE.Color(THEMES.day.shallow)};waterMat.userData.shader=s;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 coastPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ncoastPosition=position;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float coastTime; uniform vec3 shallow; varying vec3 coastPosition;').replace('#include <color_fragment>',`#include <color_fragment>
 float edge=-9.0+sin(coastPosition.x*.14)*.8+sin(coastPosition.x*.31)*.35;
 float d=edge-coastPosition.y;
 float wave=sin(d*5.3-coastTime*.8+sin(coastPosition.x*.4)*.5);
 float foam=smoothstep(.88,1.0,wave)*(1.0-smoothstep(0.,2.6,d))*smoothstep(-.1,.2,d);
 float glint=pow(max(0.,sin(coastPosition.x*.8+coastPosition.y*3.2+coastTime*.5)),28.)*smoothstep(.4,.8,sin(coastPosition.x*.61-coastPosition.y*.42))*.025;
 diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*.28)*.7)+foam*.2+glint;`);};
 const shore=x=>-9+Math.sin(x*.14)*.8+Math.sin(x*.31)*.35;
 function coastStrip(offset,width,z,material){const v=[],idx=[],N=160;for(let i=0;i<=N;i++){const x=-31+i/N*62;for(const k of [0,1])v.push(x,shore(x)+offset+k*width,z+(k? .03:0));if(i<N){const n=i*2;idx.push(n,n+1,n+2,n+1,n+3,n+2);}}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);}
 coastStrip(-.35,1.4,-.54,sand);coastStrip(.65,1.7,-.32,gravel);
 const shape=new THREE.Shape();shape.moveTo(-31,shore(-31)+1.1);for(let i=1;i<=160;i++){const x=-31+i/160*62;shape.lineTo(x,shore(x)+1.1);}shape.lineTo(31,16);shape.quadraticCurveTo(31,18,28,18);shape.lineTo(-28,18);shape.quadraticCurveTo(-31,18,-31,16);shape.closePath();
 mesh(geo(new THREE.ExtrudeGeometry(shape,{depth:.62,bevelEnabled:false,curveSegments:16})),grass,[0,0,-.7]);
 // 平緩的沿海環線；車與軌道共用同一個弧長取樣，藏在山後的回程不切換座標。
 const half=20,radius=7.4,length=half*4+2*Math.PI*radius,cy=2.4;
 function sample(s){let q=((s+half)%length+length)%length,x,y,heading;if(q<half*2){x=-half+q;y=cy-radius;heading=0;}else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}return{x,y,z:.18,heading};}
 const path={sample,length};
 function ribbon(offset,width,z,material){const v=[],idx=[],N=600;for(let i=0;i<=N;i++){const p=sample(i/N*length);for(const k of [-1,1])v.push(p.x-Math.sin(p.heading)*(offset+k*width/2),p.y+Math.cos(p.heading)*(offset+k*width/2),z);if(i<N){const n=i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);}
 ribbon(0,2.3,.015,gravel);ribbon(-.54,.08,.18,steel);ribbon(.54,.08,.18,steel);
 const dummy=new THREE.Object3D();
 function instances(g,m,items){const o=new THREE.InstancedMesh(g,m,items.length);items.forEach((p,i)=>{dummy.position.set(...p.pos);dummy.rotation.set(...(p.rot||[0,0,0]));dummy.scale.set(...p.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.castShadow=true;o.receiveShadow=true;group.add(o);return o;}
 const ties=[];for(let s=0;s<length;s+=.42){const p=sample(s);ties.push({pos:[p.x,p.y,.08],rot:[0,0,p.heading],scale:[.17,1.7,.1]});}instances(box,wood,ties);
 // 中景山丘形成遮擋，遠處軌道從山後繞回；固定三角網格不需外部地形圖。
 const hills=[[-16,4.8,7.6,4.5,7],[-8,5.3,6.5,3.7,7.8],[2,5.2,7,4,6],[12,5.2,6.2,4.1,9.2],[19,4.8,5,3.2,6.5]];
 function height(x,y){let h=0;for(const [cx,cy,rx,ry,z]of hills){const d=((x-cx)/rx)**2+((y-cy)/ry)**2;h=Math.max(h,z*Math.max(0,1-d)**1.25);}return h;}
 const hv=[],hi=[],hc=[],cols=['#8b9a76','#7b8e6c','#93a17d','#748563'].map(x=>new THREE.Color(x));
 const nx=112,ny=28;for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const x=-27+i/nx*54,y=.7+j/ny*8.6,h=height(x,y);hv.push(x,y,h-.05);const c=cols[0].clone().lerp(cols[3],Math.min(1,h/11)).multiplyScalar(.97+rand()*.06);hc.push(c.r,c.g,c.b);}
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*(nx+1)+i;hi.push(k,k+1,k+nx+1,k+1,k+nx+2,k+nx+1);}const hg=geo(new THREE.BufferGeometry());hg.setAttribute('position',new THREE.Float32BufferAttribute(hv,3));hg.setAttribute('color',new THREE.Float32BufferAttribute(hc,3));hg.setIndex(hi);hg.computeVertexNormals();mesh(hg,mat('#ffffff',{vertexColors:true,flatShading:true}));
 const crowns=[[],[],[]],stems=[],boulders=[];
 for(let i=0;i<460;i++){const x=rand()*51-25.5,y=rand()*7.4+1.2,z=height(x,y);if(z<.6)continue;const s=.38+rand()*.58;stems.push({pos:[x,y,z+.25],scale:[.09,.09,.6]});for(let j=0;j<3;j++)crowns[i%3].push({pos:[x+(rand()-.5)*s,y+(rand()-.5)*s,z+.65+j*.24],scale:[s,s*.78,s*.65]});}
 for(let i=0;i<110;i++){const x=rand()*55-27.5,y=12+rand()*4.4,s=.4+rand()*.5;stems.push({pos:[x,y,.3],scale:[.08,.08,.7]});for(let j=0;j<2;j++)crowns[i%3].push({pos:[x+(rand()-.5)*s,y+(rand()-.5)*s,.75+j*.3],scale:[s,s*.8,s*.8]});}
 for(let i=0;i<95;i++){const x=rand()*60-30,s=.15+rand()*.35;boulders.push({pos:[x,shore(x)+.4+rand()*.5,-.28],rot:[rand(),rand(),rand()],scale:[s*1.4,s,s*.8]});}
 instances(box,trunk,stems);crowns.forEach((items,i)=>instances(stoneGeo,mat(['#4e7158','#668363','#8c9c70'][i]),items));instances(stoneGeo,rock,boulders);
 // 小站只取南迴沿線的意象，不標上真實站名。
 block(cream,[13,1.4,.5],[-3,-3.05,.20]);block(sand,[13.2,1.55,.10],[-3,-3.05,.49]);
 block(mat('#d2b675'),[13.1,.11,.035],[-3,-3.79,.565]);
 block(cream,[4.6,2.3,1.8],[-4,-.9,.9]);
 const roofShape=new THREE.Shape();roofShape.moveTo(-1.5,0);roofShape.lineTo(0,.75);roofShape.lineTo(1.5,0);roofShape.closePath();const rg=geo(new THREE.ExtrudeGeometry(roofShape,{depth:5.2,bevelEnabled:false}));rg.rotateX(Math.PI/2);rg.rotateZ(Math.PI/2);mesh(rg,roof,[-6.6,-.9,1.9]);
 for(const x of [-5.5,-4,-2.5])block(windows,[.85,.04,.76],[x,-2.071,1.05]);
 for(const x of [0,3]){block(wood,[.1,.1,2.1],[x,-2.6,1.05]);block(wood,[.1,.1,2.1],[x,-1.4,1.05]);}block(roof,[4.3,2,.16],[1.4,-2,2.12]);
 for(const x of [-7,1,4]){block(wood,[1.25,.36,.12],[x,-3,.91]);for(const dx of [-.44,.44])block(wood,[.09,.24,.37],[x+dx,-3,.7]);}
 for(const x of [-10.2,5.2]){block(wood,[.10,.1,2.35],[x,-3.05,1.55]);block(cream,[1.3,.12,.64],[x,-3.05,2.1]);block(roof,[1.3,.14,.13],[x,-3.05,1.88]);}
 const lights=[];for(const x of [-9,3,8]){block(wood,[.11,.11,2.8],[x,-1.8,1.4]);block(wood,[.7,.1,.08],[x+.3,-1.8,2.75]);block(lamp,[.35,.27,.12],[x+.55,-1.8,2.68]);const l=new THREE.PointLight('#ffca84',0,5,2);l.position.set(x+.55,-1.8,2.4);group.add(l);lights.push(l);}
 // 海側的低紅欄杆留出列車視線。
 for(let x=-11;x<=7;x+=.72)block(red,[.07,.07,.6],[x,-7.2,.2]);block(red,[18.2,.07,.065],[-2,-7.2,.50]);
 // 同材質的靜態方塊合批，欄杆、站房細節不各佔一次 draw call。
 const batches=new Map();for(const o of [...group.children])if(o.isMesh&&!o.isInstancedMesh&&o.geometry===box){if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push({pos:o.position.toArray(),rot:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()});group.remove(o);}for(const [m,items]of batches)instances(box,m,items);
 const anchors={water:[-4,-14,-.61],station:[-4,-1,1],rail:[0,-5,.18],mountain:[12,5,6],shore:[10,shore(10),-.45]};
 return {group,path,anchors,label:'南迴海岸',camera:{yaw:-1.15,elevation:.65,radius:48},themes:THEMES,
 update(time,period='day'){const t=THEMES[period]||THEMES.day;waterMat.color.set(t.water);if(waterMat.userData.shader){waterMat.userData.shader.uniforms.coastTime.value=time;waterMat.userData.shader.uniforms.shallow.value.set(t.shallow);}windows.emissiveIntensity=period==='night'?1.2:period==='sunset'?.35:0;lamp.emissiveIntensity=period==='night'?2:.08;lights.forEach(l=>l.intensity=period==='night'?5:0);return t;},
 dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 };
}
