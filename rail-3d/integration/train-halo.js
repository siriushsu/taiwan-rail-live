import * as THREE from '../vendor/three.module.js';
import {haloNight,haloPalette,scatterCar,nameplateSprite} from './train-halo-style.js';
import {trainDisplayOpacity} from './train-display.js';

const shift=(c,a,m)=>[c[0]+Math.cos(a)*m/(111320*Math.cos(c[1]*Math.PI/180)),c[1]+Math.sin(a)*m/110574];
const corners=[[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]];
export function createTrainHalo(scene) {
  const material=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthTest:true,depthWrite:false,toneMapped:false,
    vertexShader:`attribute vec4 haloColor; varying vec2 vHaloUV; varying vec4 vHaloColor;
      void main(){vHaloUV=uv;vHaloColor=haloColor;gl_Position=vec4(position,1.0);}`,
    fragmentShader:`varying vec2 vHaloUV; varying vec4 vHaloColor;
      void main(){float d=length(vHaloUV);if(d>=1.0)discard;float a;
        if(d<.18)a=mix(1.0,.87,d/.18);
        else if(d<.4)a=mix(.87,.5,(d-.18)/.22);
        else if(d<.64)a=mix(.5,.17,(d-.4)/.24);
        else if(d<.84)a=mix(.17,.025,(d-.64)/.20);
        else a=mix(.025,0.0,(d-.84)/.16);
        gl_FragColor=vec4(vHaloColor.rgb,vHaloColor.a*a);}`});
  function batch(layer) {
    const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.name='train-halo';mesh.frustumCulled=false;mesh.layers.set(layer);mesh.renderOrder=2;mesh.visible=false;scene.add(mesh);
    return {mesh,capacity:0,count:0};
  }
  // 地面光只在最後的地面 pass 畫一次；地下光沿用既有地下透視的深度規則。
  const surface=batch(3),underground=batch(1),batches=[surface,underground];
  // 自製列車名牌:光環關著時,3D 近看改畫這個代替——現有設計沒有車號牌可以擴充,
  // 走跟光環同一套螢幕空間貼圖技巧(不用 Three.js 一般的相機投影,跟其餘列車算繪一致)。
  // 只會有一班自製車,不必像 ensure() 那樣動態長格——固定 6 頂點(兩個三角形)重複覆寫即可。
  const nameplateMaterial=new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
    uniforms:{map:{value:null}},
    vertexShader:`attribute vec2 tagUv; varying vec2 vTagUv; void main(){vTagUv=tagUv;gl_Position=vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D map; varying vec2 vTagUv; void main(){gl_FragColor=texture2D(map,vTagUv);}`});
  const nameplateGeometry=new THREE.BufferGeometry();
  nameplateGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(18),3).setUsage(THREE.DynamicDrawUsage));
  nameplateGeometry.setAttribute('tagUv',new THREE.BufferAttribute(new Float32Array(12),2).setUsage(THREE.DynamicDrawUsage));
  const nameplateMesh=new THREE.Mesh(nameplateGeometry,nameplateMaterial);
  nameplateMesh.name='own-train-nameplate';nameplateMesh.frustumCulled=false;nameplateMesh.layers.set(3);nameplateMesh.renderOrder=5;nameplateMesh.visible=false;scene.add(nameplateMesh);
  let nameplateTexture=null,nameplateKey='';
  function nameplateAt(cx,cy,z,label,color,sizeMul,width,height,isHSR) {
    const key=(isHSR?'hsr':'std')+':'+label+':'+color;
    if(key!==nameplateKey){nameplateTexture?.dispose();nameplateTexture=new THREE.CanvasTexture(nameplateSprite(label,color,isHSR));nameplateKey=key;nameplateMaterial.uniforms.map.value=nameplateTexture;}
    const w=96*sizeMul,h=w*80/256,offsetY=30*sizeMul, // 貼圖畫布 256x80,固定長寬比;往上偏移,浮在車頭正上方
      x0=cx-w/2,x1=cx+w/2,y0=cy-offsetY-h/2,y1=cy-offsetY+h/2,
      ndc=(x,y)=>[x/width*2-1,1-y/height*2];
    const a=ndc(x0,y1),b=ndc(x1,y1),c=ndc(x1,y0),d=ndc(x0,y0);
    nameplateGeometry.attributes.position.array.set([a[0],a[1],z, b[0],b[1],z, c[0],c[1],z, a[0],a[1],z, c[0],c[1],z, d[0],d[1],z]);
    // CanvasTexture 預設 flipY=true(上傳時整張上下翻),所以螢幕上緣要對 v=1、下緣對 v=0;
    // 寫反了名牌會上下顛倒——而「有沒有洋紅像素」那種在場判準看不出來。
    nameplateGeometry.attributes.tagUv.array.set([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]);
    nameplateGeometry.attributes.position.needsUpdate=true;nameplateGeometry.attributes.tagUv.needsUpdate=true;
    nameplateMesh.visible=true;
  }
  const stats={enabled:true,night:0,strength:.7,trains:0,cars:0,clouds:0,surface:0,underground:0,buildMs:0,capacity:0};
  function ensure(b,count) {
    if(count<=b.capacity)return;
    const capacity=Math.max(192,b.capacity*2,count),g=new THREE.BufferGeometry();
    for(const [name,size]of [['position',3],['uv',2],['haloColor',4]])g.setAttribute(name,new THREE.BufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
    // 成長時保留本幀已經寫入的頂點，舊 geometry 立即釋放。
    for(const [name,a]of Object.entries(b.mesh.geometry.attributes))g.attributes[name].array.set(a.array);
    b.mesh.geometry.dispose();b.mesh.geometry=g;b.capacity=capacity;
  }
  function update(models,project,width,height,display) {
    const started=performance.now(),night=haloNight(globalThis.railIslandSunlight?.current,display?.dark);
    Object.assign(stats,{enabled:display?.trainHalo!==false,night,strength:.7+.3*night,trains:0,cars:0,clouds:0,surface:0,underground:0});
    for(const b of batches){b.count=0;b.mesh.visible=false;}
    nameplateMesh.visible=false;
    // 真車的光環開關(display.trainHalo,「更多」選單)只管真車;自製車另有自己的開關(兩個開關互不影響),
    // 所以這個 if 不能再包住整個迴圈——自製車要繞過 stats.enabled,在迴圈內部各自判斷。
    if(display?.enabled!==false)for(const m of models.values()) {
      if(!m.group?.visible||!m.screenPose)continue;
      const ownTrain=!!m.screenPose.ownTrain;
      if(!stats.enabled&&!ownTrain)continue;
      const {sample,color}=m.screenPose,opacity=trainDisplayOpacity(m.screenPose.displayOpacity),cars=sample.cars,first=cars[0],last=cars.at(-1);
      if(!first||opacity<=0)continue;
      // 地下車的光暈畫在地下那一趟，深度要用那一趟往下延伸的遠裁切面（project 第三個參數），地面車照主畫面。
      const p=cars.map(c=>project(c.coordinate,c.height+1.75,c.underground)),before=project(shift(first.coordinate,first.angle,m.model.parts[0].bodyLengthM/2),first.height+1.75,first.underground),after=project(shift(last.coordinate,last.angle,-m.model.parts.at(-1).bodyLengthM/2),last.height+1.75,last.underground);
      let radius=2.5;
      for(let i=0;i<cars.length;i++) {
        if(p[i].z<-1||p[i].z>1)continue;
        const c=cars[i],side=m.model.widthM*sample.displayScale/2;
        for(const sign of [-1,1])for(const z of [.1,3.5]){const q=project(shift(c.coordinate,c.angle+Math.PI/2,sign*side),c.height+z,c.underground);radius=Math.max(radius,Math.hypot(q.x-p[i].x,q.y-p[i].y));}
      }
      radius=Math.min(26,radius);
      // 自製列車:光環關著時改畫名牌(跟 2D 車牌同形同色),不進光環算繪;光環開著時 warmMix:false(深夜不跟真車
      // 收斂成同一個暖色)、大小倍率放大 radius(車體本身不放大,只放大光環——3D 車體維持真實比例)。
      if(ownTrain&&m.screenPose.haloOn===false){
        if(p[0]&&p[0].z>=-1&&p[0].z<=1)nameplateAt(p[0].x,p[0].y,p[0].z,sample.label||'',color,m.screenPose.haloSizeMul||1,width,height,m.screenPose.systemId==='thsr_sched');
        continue;
      }
      const sizeMul=ownTrain?(m.screenPose.haloSizeMul||1):1;
      radius*=sizeMul;
      const palette=haloPalette(color,night,ownTrain?{warmMix:false}:undefined);let visible=false;
      cars.forEach((c,k)=>{
        const q=p[k],a=p[k-1]||before,z=p[k+1]||after;
        if(![q,a,z].every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.z>=-1&&v.z<=1))return;
        // 外觀固定為螢幕上的柔光，深度則沿車廂所在水平面變化。
        // 整片使用中心深度會被地面切掉一半；停用深度又會穿過前景建物。
        const east=project(shift(c.coordinate,0,10),c.height+1.75,c.underground),north=project(shift(c.coordinate,Math.PI/2,10),c.height+1.75,c.underground),
          ex=east.x-q.x,ey=east.y-q.y,ez=east.z-q.z,nx=north.x-q.x,ny=north.y-q.y,nz=north.z-q.z,det=ex*ny-ey*nx,
          gx=Math.abs(det)>1e-8?(ez*ny-ey*nz)/det:0,gy=Math.abs(det)>1e-8?(ex*nz-ez*nx)/det:0;
        const b=c.underground?underground:surface;let carVisible=false;
        scatterCar(a,q,z,radius,k,palette.alpha*opacity,(x,y,angle,rx,ry,alpha)=>{
          const cos=Math.cos(angle),sin=Math.sin(angle),extentX=Math.abs(cos*rx)+Math.abs(sin*ry),extentY=Math.abs(sin*rx)+Math.abs(cos*ry);
          if(x+extentX<0||x-extentX>width||y+extentY<0||y-extentY>height)return;
          ensure(b,b.count+6);const attr=b.mesh.geometry.attributes;
          for(const [u,v]of corners){const i=b.count++,px=x+u*rx*cos-v*ry*sin,py=y+u*rx*sin+v*ry*cos;
            attr.position.array.set([px/width*2-1,1-py/height*2,q.z+gx*(px-q.x)+gy*(py-q.y)],i*3);attr.uv.array.set([u,v],i*2);attr.haloColor.array.set([...palette.rgb,alpha],i*4);}
          stats.clouds++;carVisible=true;
        });
        if(carVisible){stats.cars++;visible=true;}
      });
      if(visible)stats.trains++;
    }
    for(const b of batches){const g=b.mesh.geometry;g.setDrawRange(0,b.count);b.mesh.visible=b.count>0;
      if(b.count)for(const a of Object.values(g.attributes)){a.clearUpdateRanges();a.addUpdateRange(0,b.count*a.itemSize);a.needsUpdate=true;}}
    stats.surface=surface.count/6;stats.underground=underground.count/6;stats.capacity=surface.capacity+underground.capacity;stats.buildMs=performance.now()-started;
  }
  return {stats,update,destroy(){for(const b of batches){scene.remove(b.mesh);b.mesh.geometry.dispose();}material.dispose();scene.remove(nameplateMesh);nameplateGeometry.dispose();nameplateMaterial.dispose();nameplateTexture?.dispose();}};
}
