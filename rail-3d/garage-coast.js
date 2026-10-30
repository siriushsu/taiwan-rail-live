// 頭城海岸風景示意。天空、島、海、陸地與軌道全部經同一個世界座標及相機投影。
import * as THREE from './vendor/three.module.js';
const THEMES={
 sunrise:{top:'#596f9c',horizon:'#f6c8a4',sea:'#306b88',shallow:'#5da3ac',sun:'#ffe2b1',light:'#ffdbc0',ambient:'#adc1df',power:2.0,night:0,sunZ:.045},
 day:{top:'#4193d0',horizon:'#c4e3ee',sea:'#125e89',shallow:'#369caa',sun:'#fff5db',light:'#fff4de',ambient:'#cee4f4',power:2.6,night:0,sunZ:.48},
 sunset:{top:'#626b97',horizon:'#edb3a0',sea:'#445b80',shallow:'#80989f',sun:'#facfae',light:'#f5c0a4',ambient:'#b8b6ce',power:1.6,night:0,sunZ:-.24},
 night:{top:'#040b1c',horizon:'#31465f',sea:'#0c243d',shallow:'#23505e',sun:'#d2e7ed',light:'#b1c8e7',ambient:'#607995',power:.85,night:1,sunZ:.13}
};
const wrap=(x,m)=>((x%m)+m)%m;
const noiseGLSL=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
// 格點先折回 ±512 格再算 hash：sin 的參數跟著行駛距離變大，GPU 算不準，跑約 2 km 道碴紋路就平掉（Mali 約 100 m）。
// ±512 格內亂數不變；紋路每 1024 格重複（道碴 15.8 m，看不出來）。同 App 的 coastLatticeHash。
float latticeHash(vec2 i){return hash(i-1024.*floor(i/1024.+.5));}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(latticeHash(i),latticeHash(i+vec2(1.,0.)),f.x),mix(latticeHash(i+vec2(0.,1.)),latticeHash(i+1.),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.55+noise(p*2.03)*.27+noise(p*4.07)*.13+noise(p*8.11)*.05;}
`;
const shoreGLSL=`float shoreAt(float x){return 20.+sin(x*.055)*.65+sin(x*.17)*.22;}`;
// 車燈照地，同 App 的 coastTrainSpill：cabin＝車窗暖光、編組兩端 x、灑地強度；beam＝車頭端 x、行進方向、強度。回傳線性照度，只照貼地的東西。
const spillGLSL=`vec3 coastTrainSpill(vec3 p,vec4 cabin,vec4 beam){float ground=1.-smoothstep(.3,.7,p.z),side=abs(p.y)-.62;
 float along=smoothstep(cabin.y-.3,cabin.y+1.5,p.x)*(1.-smoothstep(cabin.z-1.5,cabin.z+.3,p.x));
 float windows=cabin.x*cabin.w*along*smoothstep(0.,.3,side)*exp(-max(side,0.)*1.2);
 float ahead=(p.x-beam.x)*beam.y,width=.7+max(ahead,0.)*.28;
 float pool=beam.z*smoothstep(0.,.5,ahead)*exp(-max(ahead,0.)*.16)*(1.-smoothstep(width*.55,width,abs(p.y)));
 return ground*(vec3(1.,.76,.46)*windows+vec3(1.,.92,.78)*pool);}`;
const lampGLSL='outgoingLight+=vec3(1.,.91,.68)*5.*lampHead.z*step(lampHead.x,lightWorld.x)*step(lightWorld.x,lampHead.y)+vec3(1.,.05,.02)*2.5*lampTail.z*step(lampTail.x,lightWorld.x)*step(lightWorld.x,lampTail.y);';
// 車內燈在天花板：窗上緣亮、下緣（座椅背）暗；兩端駕駛室不亮。
const cabinGLSL='outgoingLight+=vec3(1.,.85,.6)*1.4*cabin.x*mix(.45,1.,smoothstep(.55,1.25,lightWorld.z))*smoothstep(cabin.y+.35,cabin.y+.8,lightWorld.x)*(1.-smoothstep(cabin.z-.8,cabin.z-.35,lightWorld.x));';
const groundGLSL='outgoingLight+=material.diffuseColor*coastTrainSpill(lightWorld,cabin,beam)/PI;';
// 在 PBR 材質加世界座標，色調映射前把車燈光加進 outgoingLight（同 App 在 ACES 前加色）。燈關著時 uniform 全 0，畫面不變。
// 快取鍵接上原本的鍵：道床已有 onBeforeCompile，不分開的話鋼軌會拿到道床的程式。
function addLight(m,uniforms,code){const before=m.onBeforeCompile,key=m.customProgramCacheKey()+'|'+code;
 m.customProgramCacheKey=()=>key;m.onBeforeCompile=(s,r)=>{before.call(m,s,r);Object.assign(s.uniforms,uniforms);
  s.vertexShader='varying vec3 lightWorld;\n'+s.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvec4 lightPos=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nlightPos=instanceMatrix*lightPos;\n#endif\nlightWorld=(modelMatrix*lightPos).xyz;');
  s.fragmentShader=`varying vec3 lightWorld;uniform vec4 ${Object.keys(uniforms).join(',')};\n${spillGLSL}\n`+s.fragmentShader.replace('#include <opaque_fragment>',code+'\n#include <opaque_fragment>');};
 m.needsUpdate=true;return m;}
// 車模 lamp 材質的燈體（模型座標）：0.25 m 格子分群、相鄰 26 格算同一盞，同 App 的 lampBlobs。
const blobCache=new WeakMap();
function lampBlobs(asset){
 let blobs=blobCache.get(asset);if(blobs)return blobs;blobs=[];
 const g=asset.geometry,pos=g.attributes.position,index=g.index,cells=new Map();
 for(const group of g.groups)if(asset.materials[group.materialIndex]?.name==='lamp')for(let k=group.start;k<group.start+group.count;k++){
  const p=new THREE.Vector3().fromBufferAttribute(pos,index?index.getX(k):k),cell=[p.x,p.y,p.z].map(v=>Math.floor(v/.25)),key=cell.join(),box=cells.get(key);
  if(box)box.expandByPoint(p);else cells.set(key,Object.assign(new THREE.Box3(p.clone(),p.clone()),{cell}));
 }
 while(cells.size){const [seed,first]=cells.entries().next().value;cells.delete(seed);const stack=[first],box=first.clone();
  while(stack.length){const [x,y,z]=stack.pop().cell;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){const key=[x+dx,y+dy,z+dz].join(),next=cells.get(key);if(!next)continue;cells.delete(key);stack.push(next);box.union(next);}}
  blobs.push({center:box.getCenter(new THREE.Vector3()),size:box.getSize(new THREE.Vector3())});
 }
 blobCache.set(asset,blobs);return blobs;
}
// 各時段的車燈強度（燈體、光暈、車窗、車窗灑地、頭燈照地），同 App 的 trackLights；白天只有燈體微亮。
const LIGHTS={sunrise:[.6,.45,0,0,.3],day:[.3,0,0,0,0],sunset:[1,1,0,0,.7],night:[1,1,1,1,1]},MAX_HALOS=32;
const color=s=>new THREE.Color(s);
// 海岸車窗反射同一時段的天光；PMREM 保留世界 Z 軸朝上，與場景及車體一致。
export function createCoastReflection(renderer,theme){
 const scene=new THREE.Scene(),geometry=new THREE.SphereGeometry(30,32,16);
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,toneMapped:false,uniforms:{
  top:{value:color(theme.top)},horizon:{value:color(theme.horizon)},sea:{value:color(theme.sea)},ground:{value:color(theme.night?'#17271f':'#73815b')},sun:{value:color(theme.sun)},sunDir:{value:new THREE.Vector3(-.24,.96,theme.sunZ).normalize()},night:{value:theme.night}
 },vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
 varying vec3 direction;uniform vec3 top,horizon,sea,ground,sun,sunDir;uniform float night;
 void main(){vec3 d=normalize(direction);float h=max(d.z,0.);vec3 sky=mix(horizon,top,pow(clamp(h,0.,1.),.55));
 float clouds=pow(.5+.5*sin(atan(d.y,d.x)*4.+h*15.),3.)*exp(-pow((h-.28)*5.,2.));
 sky=mix(sky,mix(horizon,vec3(1.),.5),clouds*(1.-night)*.45);
 vec3 land=mix(ground,sea,smoothstep(-.1,.2,d.y));land=mix(land,horizon,exp(d.z*8.)*.25);
 vec3 c=mix(land,sky,smoothstep(-.025,.025,d.z));c+=sun*exp(-length(d-sunDir)*24.)*(night>.5?.12:2.5);
 gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>
 }`});
 const sphere=new THREE.Mesh(geometry,material);scene.add(sphere);const pmrem=new THREE.PMREMGenerator(renderer);
 try{return pmrem.fromScene(scene,.035,.1,100);}finally{geometry.dispose();material.dispose();pmrem.dispose();}
}
export function createCoast(){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set(),instances=[];
 const geometry=g=>(geometries.add(g),g),material=m=>(materials.add(m),m);
 const mesh=(g,m)=>{const o=new THREE.Mesh(geometry(g),material(m));group.add(o);return o;};
 const uniforms={distance:{value:0},time:{value:0},top:{value:color(THEMES.day.top)},horizon:{value:color(THEMES.day.horizon)},deep:{value:color(THEMES.day.sea)},shallow:{value:color(THEMES.day.shallow)},sun:{value:color(THEMES.day.sun)},sunDir:{value:new THREE.Vector3(-.24,.96,.48).normalize()},night:{value:0},
  lampHead:{value:new THREE.Vector4()},lampTail:{value:new THREE.Vector4()},cabin:{value:new THREE.Vector4()},beam:{value:new THREE.Vector4()}};
 const shader=(vertexShader,fragmentShader,extra={})=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,...extra});
 const worldVertex=`varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`;
 const finish=`gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>`;
 const sky=mesh(new THREE.SphereGeometry(1400,40,20),shader(worldVertex,`
 varying vec3 world;uniform vec3 top,horizon,sun,sunDir;uniform float night;${noiseGLSL}
 void main(){vec3 d=normalize(world-cameraPosition);float h=max(0.,d.z);vec3 c=mix(horizon,top,pow(clamp(h*1.6,0.,1.),.52));
 float a=length(d-sunDir);c+=sun*exp(-a*16.)*(night>.5?.08:.25);c=mix(c,sun,(1.-smoothstep(.008,.012,a)));
 vec2 uv=vec2(atan(d.x,d.y),asin(d.z));
 if(night>.5){vec2 grid=uv*vec2(110.,85.);vec2 cell=floor(grid),f=fract(grid)-.5;float star=(1.-smoothstep(.035,.16,length(f))) * step(.985,hash(cell));c+=vec3(.8,.86,1.)*star*smoothstep(.015,.15,d.z);}
 else {vec2 q=uv*vec2(2.5,13.);float cloud=smoothstep(.52,.76,fbm(q+fbm(q*.6)));cloud*=smoothstep(.015,.12,d.z)*(1.-smoothstep(.32,.6,d.z));c=mix(c,mix(horizon,vec3(1.),.45),cloud*.65);}
 ${finish}}
 `,{side:THREE.BackSide,depthWrite:false,toneMapped:false}));sky.renderOrder=-10;sky.frustumCulled=false;
 const sea=mesh(new THREE.PlaneGeometry(2800,2800),shader(worldVertex,`
 varying vec3 world;uniform vec3 deep,shallow,horizon,sun,sunDir;uniform float distance,time,night;${noiseGLSL}${shoreGLSL}
 void main(){vec2 p=world.xy;p.x-=distance;float depth=max(0.,p.y-shoreAt(p.x));float n=fbm(p*vec2(.65,2.8)+vec2(time*.06,-time*.2));
 float ripple=sin(p.y*4.1+p.x*.34-time*1.15+noise(p*.8)*2.);float ripple2=sin(p.y*8.5-p.x*.65-time*1.9+noise(p*2.)*5.);
 vec3 normal=normalize(vec3(.025*cos(p.x*.7+p.y*3.-time+noise(p)*3.),.032*ripple+.019*ripple2,1.));vec3 view=normalize(cameraPosition-world);
 float fresnel=pow(1.-max(0.,dot(view,normal)),4.);vec3 c=mix(shallow,deep,smoothstep(0.,45.,depth));c*=.87+n*.28;
 c=mix(c,horizon,fresnel*.18);float spec=pow(max(0.,dot(reflect(-sunDir,normal),view)),170.);c+=sun*spec*(night>.5?.32:.55);
 float edge=sin(depth*3.5-time*1.1+noise(p*.6)*1.3);float foam=smoothstep(.83,1.,edge)*exp(-depth*.75);foam+=exp(-depth*depth*3.)*.30;c=mix(c,mix(horizon,vec3(1.),.5),foam*.75);
 float haze=1.-exp(-length(world-cameraPosition)*.0014);c=mix(c,horizon,haze*.75);${finish}}
 `,{toneMapped:false}));sea.position.z=-.64;
 // 緩坡草地 → 礫石／濕沙 → 水線。岸線函式與海浪共用，轉動相機時不會裂開。
 const land=mesh(new THREE.PlaneGeometry(400,120,220,86).translate(0,-20,0),shader(`
 varying vec3 world;uniform float distance;${noiseGLSL}${shoreGLSL}
 void main(){vec3 p=position;float x=p.x-distance,sh=shoreAt(x);float dune=smoothstep(1.5,3.,abs(p.y))*(1.-smoothstep(4.,sh,p.y));
 p.z=-.18+dune*(.05+fbm(vec2(x*.35,p.y*.5))*.18)-smoothstep(sh-3.,sh+1.,p.y)*.62;
 world=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,`
 varying vec3 world;uniform float distance,night;uniform vec3 horizon;uniform vec4 cabin,beam;${noiseGLSL}${shoreGLSL}${spillGLSL}
 void main(){vec2 p=world.xy;p.x-=distance;float sh=shoreAt(p.x),grain=noise(p*95.),variation=fbm(p*.7);vec3 meadow=mix(vec3(.095,.16,.085),vec3(.24,.31,.13),variation);
 vec3 sand=mix(vec3(.18,.19,.175),vec3(.34,.33,.29),variation);vec3 c=mix(meadow,sand,smoothstep(sh-4.,sh-2.,p.y));c*=.82+grain*.32;
 c*=1.-smoothstep(sh-1.9,sh+.2,p.y)*.40;vec3 trainLight=c*coastTrainSpill(world,cabin,beam)*.3;c*=mix(1.,.32,night);c+=trainLight;c=mix(c,horizon,(1.-exp(-length(world-cameraPosition)*.002))*.6);${finish}}
 `,{toneMapped:false}));
 // 龜甲、龜首和低平龜尾是有深度的山體；細分山坡保留侵蝕溝與海崖，不用平面剪影。
 const islandGeometry=new THREE.PlaneGeometry(76,40,220,110),ip=islandGeometry.attributes.position;
 const colors=new Float32Array(ip.count*3);
 const noise2=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),h=(a,b)=>{const t=Math.sin(a*127.1+b*311.7)*43758.5453;return t-Math.floor(t);};return (h(ix,iy)*(1-u)+h(ix+1,iy)*u)*(1-v)+(h(ix,iy+1)*(1-u)+h(ix+1,iy+1)*u)*v;};
 const terrain=(x,y)=>{
  const r=Math.hypot((x+6)/25,y/13),body=12.8*Math.pow(Math.max(0,1-Math.pow(r,1.45)),1.22);
  const head=5.0*Math.pow(Math.max(0,1-Math.hypot((x-25)/7,(y+1)/6)),.52);
  const neck=2.5*Math.max(0,1-Math.hypot((x-17)/10,y/5));
  const tail=1.25*Math.max(0,1-Math.hypot((x+29)/9,y/4));
  const h=Math.max(body,head,neck,tail),edge=Math.min(1,h/1.2);
  const erosion=(Math.sin(Math.atan2(y,x+6)*13+Math.hypot(x+6,y)*.19)*.46+(noise2(x*.5,y*.5)-.5)*.38+(noise2(x*1.6,y*1.6)-.5)*.12)*edge;
  return Math.max(-.78,h+erosion-.55);
 };
 for(let i=0;i<ip.count;i++){const x=ip.getX(i),y=ip.getY(i),h=terrain(x,y);ip.setZ(i,h);
  const slope=Math.hypot(terrain(x+.2,y)-terrain(x-.2,y),terrain(x,y+.2)-terrain(x,y-.2))/.4;
  const v=noise2(x*.75,y*.75)*.7+noise2(x*2.3,y*2.3)*.3;
  const cliff=THREE.MathUtils.clamp((1.5-h)/1.3,0,1)*.85+THREE.MathUtils.clamp((slope-1.1)/2,0,.65);
  const c=new THREE.Color(.022+v*.025,.065+v*.04,.032+v*.02).lerp(new THREE.Color(.13,.14,.125),Math.min(1,cliff));
  colors.set([c.r,c.g,c.b],i*3);
 }
 islandGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));islandGeometry.computeVertexNormals();
 const island=mesh(islandGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0}));island.position.set(18,150,0);
 const ground={cabin:uniforms.cabin,beam:uniforms.beam},receive=m=>addLight(m,ground,groundGLSL);
 const train={lampHead:uniforms.lampHead,lampTail:uniforms.lampTail,cabin:uniforms.cabin},lit=new WeakSet();
 const bedMat=material(new THREE.MeshStandardMaterial({color:'#7b817d',roughness:1}));
 bedMat.onBeforeCompile=s=>{s.uniforms.distance=uniforms.distance;s.vertexShader='varying vec3 groundPos;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngroundPos=position;');s.fragmentShader='uniform float distance;varying vec3 groundPos;\n'+noiseGLSL+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=noise(vec2((groundPos.x-distance)*65.,groundPos.y*65.));diffuseColor.rgb*=.64+grain*.65;');};receive(bedMat);
 function box(w,d,h,m,x,y,z){const o=mesh(new THREE.BoxGeometry(w,d,h),m);o.position.set(x,y,z);return o;}
 const bed=box(400,2.05,.14,bedMat,0,0,-.08);
 const steel=receive(new THREE.MeshStandardMaterial({color:'#85949b',roughness:.34,metalness:.75}));for(const y of [-.55,.55]){box(400,.07,.095,steel,0,y,.11);box(400,.13,.025,steel,0,y,.16);}
 const sleepers=new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(.16,1.80,.10)),material(receive(new THREE.MeshStandardMaterial({color:'#756d60',roughness:1}))),321);group.add(sleepers);instances.push(sleepers);
 const dummy=new THREE.Object3D();
 // 草叢與岸邊碎石使用少量 instancing；它們和道床一起移動，遠島維持遠景。
 let seed=1977;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
 const rocks=new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(1,0)),material(receive(new THREE.MeshStandardMaterial({color:'#7b8078',roughness:1}))),220),rockData=[];group.add(rocks);instances.push(rocks);
 for(let i=0;i<220;i++)rockData.push([random()*160-80,17.5+random()*2.1,.10+random()*.23,random()*6.28]);
 const blades=[];for(let j=0;j<3;j++){const a=j*2.1,dx=Math.cos(a)*.05,dy=Math.sin(a)*.05;blades.push(-dx,-dy,0,dx,dy,0,dx*.8,dy*.8,.24+j*.045);}
 const grassG=new THREE.BufferGeometry();grassG.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));grassG.computeVertexNormals();
 const grass=new THREE.InstancedMesh(geometry(grassG),material(receive(new THREE.MeshStandardMaterial({color:'#7b9562',side:THREE.DoubleSide,roughness:1}))),620),grassData=[];group.add(grass);instances.push(grass);
 for(let i=0;i<620;i++)grassData.push([random()*160-80,i%2?-2.3-random()*4:2.3+random()*3,.5+random(),random()*6.28]);
 const shadow=mesh(new THREE.PlaneGeometry(14,2.2),new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;void main(){float a=(1.-smoothstep(.2,.5,abs(v.y-.5)))*(1.-smoothstep(.43,.5,abs(v.x-.5)));gl_FragColor=vec4(.015,.025,.03,a*.27);}'}));shadow.position.z=-.001;
 // 車燈光暈：面向鏡頭的方片（半徑是世界公尺），中心偏白、外圈是燈色，加法混色、不寫深度，同 App 的 glow_fs；輸出不轉色彩空間，跟 App 一樣直接疊在畫面上。
 const plane=new THREE.PlaneGeometry(2,2),haloGeometry=geometry(new THREE.InstancedBufferGeometry().copy(plane));plane.dispose();
 const haloAt=new THREE.InstancedBufferAttribute(new Float32Array(MAX_HALOS*4),4),tint=new THREE.InstancedBufferAttribute(new Float32Array(MAX_HALOS*4),4);
 haloGeometry.setAttribute('halo',haloAt);haloGeometry.setAttribute('tint',tint);haloGeometry.instanceCount=0;
 const halos=mesh(haloGeometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  vertexShader:'attribute vec4 halo,tint;varying vec2 v;varying vec4 c;void main(){v=position.xy;c=tint;vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);gl_Position=projectionMatrix*viewMatrix*vec4(halo.xyz+(right*position.x+up*position.y)*halo.w,1.);}',
  fragmentShader:'varying vec2 v;varying vec4 c;void main(){float r=length(v),glow=(exp(-r*r*9.)*.9+exp(-r*4.)*.25)*(1.-smoothstep(.8,1.,r)),core=1.-smoothstep(.03,.12,r);gl_FragColor=vec4(mix(c.rgb,vec3(1.,.99,.94),core*.85),min(1.,(glow+core*.8)*c.w));}'}));
 halos.frustumCulled=false;halos.renderOrder=1;halos.visible=false;
 const toEye=new THREE.Vector3();
 let previousPeriod;
 return {group,island,land,sea,bed,sky,shadow,update(distance,period,camera,time=0){
  const p=THEMES[period]||THEMES.day;uniforms.distance.value=distance;uniforms.time.value=time;
  sky.position.copy(camera.position);
  if(period!==previousPeriod){for(const [key,value]of Object.entries({top:p.top,horizon:p.horizon,deep:p.sea,shallow:p.shallow,sun:p.sun}))uniforms[key].value.set(value);uniforms.night.value=p.night;uniforms.sunDir.value.set(-.24,.96,p.sunZ).normalize();previousPeriod=period;}
  const phase=wrap(distance,.5);for(let i=0;i<321;i++){dummy.position.set((i-160)*.5+phase,0,.015);dummy.rotation.set(0,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();sleepers.setMatrixAt(i,dummy.matrix);}sleepers.instanceMatrix.needsUpdate=true;
  for(const [o,data]of [[rocks,rockData],[grass,grassData]]){data.forEach(([x,y,s,r],i)=>{dummy.position.set(wrap(x+distance+80,160)-80,y,o===rocks?-.04:-.10);dummy.scale.set(s,s,o===rocks?s*.65:s);dummy.rotation.set(0,0,r);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.instanceMatrix.needsUpdate=true;}
  return p;
 },
 // 海岸行旅的車燈，同 App 的 trackLights：列車沿世界 x 軸排成直線（呼叫前要更新過 matrixWorld），行進方向那端是頭燈、另一端是尾燈。
 // 燈體位置取自車模的 lamp 材質；車端沒有 lamp 的車（客車廂等）在車端左右各放一盞光暈。consist 給 null（沒入庫、環形、近看）就全部關掉。回傳光暈數。
 lights(consist,direction,period,eye){
  for(const k of Object.keys(train))train[k].value.set(0,0,0,0);uniforms.beam.value.set(0,0,0,0);halos.visible=false;haloGeometry.instanceCount=0;
  if(!consist)return 0;
  for(const c of consist.cars)for(const m of c.asset.materials)if((m.name==='lamp'||m.name==='glass')&&!lit.has(m)){lit.add(m);addLight(m,train,m.name==='lamp'?lampGLSL:cabinGLSL);}
  const [lamp,halo,cabin,spill,beam]=LIGHTS[period]||LIGHTS.day,length=consist.length,travel=direction===-1?1:-1,headX=travel*length/2;let n=0;
  for(const [c,endX,tail] of [[consist.cars[0],headX,false],[consist.cars.at(-1),-headX,true]]){
   const scale=c.car.scale.x;
   let lamps=lampBlobs(c.asset).map(b=>({center:b.center.clone().applyMatrix4(c.body.matrixWorld),half:b.size.clone().multiplyScalar(.5*scale)})).filter(l=>Math.abs(l.center.x-endX)<c.length*.3);
   const found=lamps.length>0;
   if(!found){const inward=tail?travel:-travel,height=c.asset.size.z*scale;lamps=[-1,1].map(side=>({center:new THREE.Vector3(endX+inward*.02,side*.3,.18+height*.3),half:new THREE.Vector3(.02,.07,.07)}));}
   const x0=Math.min(...lamps.map(l=>l.center.x-l.half.x))-.03,x1=Math.max(...lamps.map(l=>l.center.x+l.half.x))+.03;
   train[tail?'lampTail':'lampHead'].value.set(x0,x1,found?lamp*(tail?.8:1):0,0);
   if(halo>0)for(const l of lamps){if(n>=MAX_HALOS)break;
    // 光暈往鏡頭拉近半個車寬：投影位置不變，只是不被車身側面擋住。
    const center=toEye.subVectors(eye,l.center).normalize().multiplyScalar(.75).add(l.center),radius=Math.min(1.3,Math.max(.9,Math.max(l.half.y,l.half.z)*4))*(tail?.6:1);
    haloAt.setXYZW(n,center.x,center.y,center.z,radius);if(tail)tint.setXYZW(n,1,.16,.06,halo*.8);else tint.setXYZW(n,1,.91,.68,halo);n++;
   }
  }
  train.cabin.value.set(cabin,-length/2,length/2,spill*3);uniforms.beam.value.set(headX,travel,beam*6,0);
  haloGeometry.instanceCount=n;halos.visible=n>0;haloAt.needsUpdate=tint.needsUpdate=true;return n;
 },dispose(){instances.forEach(o=>o.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
