import * as THREE from '../vendor/three.module.js';
import {haloNight,haloPalette,scatterCar} from './train-halo-style.js';

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
    if(stats.enabled&&display?.enabled!==false)for(const m of models.values()) {
      if(!m.group?.visible||!m.screenPose)continue;
      const {sample,color}=m.screenPose,cars=sample.cars,first=cars[0],last=cars.at(-1);
      if(!first)continue;
      const p=cars.map(c=>project(c.coordinate,c.height+1.75)),before=project(shift(first.coordinate,first.angle,m.model.parts[0].bodyLengthM/2),first.height+1.75),after=project(shift(last.coordinate,last.angle,-m.model.parts.at(-1).bodyLengthM/2),last.height+1.75);
      let radius=2.5;
      for(let i=0;i<cars.length;i++) {
        if(p[i].z<-1||p[i].z>1)continue;
        const c=cars[i],side=m.model.widthM*sample.displayScale/2;
        for(const sign of [-1,1])for(const z of [.1,3.5]){const q=project(shift(c.coordinate,c.angle+Math.PI/2,sign*side),c.height+z);radius=Math.max(radius,Math.hypot(q.x-p[i].x,q.y-p[i].y));}
      }
      radius=Math.min(26,radius);const palette=haloPalette(color,night);let visible=false;
      cars.forEach((c,k)=>{
        const q=p[k],a=p[k-1]||before,z=p[k+1]||after;
        if(![q,a,z].every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.z>=-1&&v.z<=1))return;
        // 外觀固定為螢幕上的柔光，深度則沿車廂所在水平面變化。
        // 整片使用中心深度會被地面切掉一半；停用深度又會穿過前景建物。
        const east=project(shift(c.coordinate,0,10),c.height+1.75),north=project(shift(c.coordinate,Math.PI/2,10),c.height+1.75),
          ex=east.x-q.x,ey=east.y-q.y,ez=east.z-q.z,nx=north.x-q.x,ny=north.y-q.y,nz=north.z-q.z,det=ex*ny-ey*nx,
          gx=Math.abs(det)>1e-8?(ez*ny-ey*nz)/det:0,gy=Math.abs(det)>1e-8?(ex*nz-ez*nx)/det:0;
        const b=c.underground?underground:surface;let carVisible=false;
        scatterCar(a,q,z,radius,k,palette.alpha,(x,y,angle,rx,ry,alpha)=>{
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
  return {stats,update,destroy(){for(const b of batches){scene.remove(b.mesh);b.mesh.geometry.dispose();}material.dispose();}};
}
