import * as THREE from '../vendor/three.module.js';
import {PORTAL_DEPTH} from './tunnel-portals.js';
// DEM 沒有洞穴。只在朝向鏡頭的入口內重建洞壁深度，不清空整張地圖的深度。
// 此 pass 位於地表之後、建物之前；洞外的山與遮擋入口的建物仍沿用底圖。
export function createTunnelApertures(groundAt){
 const scene=new THREE.Scene(),meshes=[],inverse=new THREE.Matrix4(),eye=new THREE.Vector4();
 const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,
  uniforms:{clip:{value:new THREE.Matrix4()},eye:{value:new THREE.Vector3()},width:{value:3.2},spring:{value:2.8},depth:{value:PORTAL_DEPTH},night:{value:0}},
  vertexShader:'uniform mat4 clip; varying vec3 entrance; void main(){entrance=position;gl_Position=clip*vec4(position,1.);}',
  fragmentShader:`precision highp float;
   uniform mat4 clip; uniform vec3 eye; uniform float width,spring,depth,night; varying vec3 entrance;
   void main(){
    if(eye.y>=-.1)discard;
    vec3 ray=normalize(entrance-eye);if(ray.y<=.001)discard;
    float t=(depth-entrance.y)/ray.y;
    if(abs(ray.x)>.0001)t=min(t,((ray.x>0.?width:-width)-entrance.x)/ray.x);
    if(ray.z<-.0001)t=min(t,(-1.2-entrance.z)/ray.z);
    // 橢圓拱頂與射線的解析交點，與實體拱圈共用 3.2 公尺拱高。
    vec2 o=vec2(entrance.x/width,(entrance.z-spring)/3.2),d=vec2(ray.x/width,ray.z/3.2);
    float a=dot(d,d),b=dot(o,d),c=dot(o,o)-1.,disc=b*b-a*c;
    if(a>.000001&&disc>=0.){float roof=(-b+sqrt(disc))/a;if(roof>0.&&entrance.z+ray.z*roof>=spring)t=min(t,roof);}
    vec3 hit=entrance+ray*max(t,0.);vec4 p=clip*vec4(hit,1.);
    gl_FragDepth=(p.z/p.w)*.5+.5;
    float fade=exp(-hit.y*.12)*(1.-night*.45);
    vec3 ink=mix(vec3(.025,.035,.042),vec3(.19,.25,.27),fade);
    gl_FragColor=vec4(ink,1.);
   }`});
 material.onBeforeRender=(_r,_s,c,_g,m)=>{const u=material.uniforms;u.clip.value.multiplyMatrices(c.projectionMatrix,m.modelViewMatrix);inverse.copy(u.clip.value).invert();eye.set(0,0,1,0).applyMatrix4(inverse);u.eye.value.set(eye.x/eye.w,eye.y/eye.w,eye.z/eye.w);u.width.value=m.userData.portal.halfWidth;u.spring.value=m.userData.portal.spring;material.uniformsNeedUpdate=true;};
 function clear(){for(const m of meshes){scene.remove(m);m.geometry.dispose();}meshes.length=0;}
 return {set(portals){clear();for(const p of portals){
   const hw=p.halfWidth,spring=p.spring??2.8,edge=[[-hw,0,-1.2],[hw,0,-1.2],[hw,0,spring]];
   for(let i=1;i<=20;i++){const a=i*Math.PI/20;edge.push([hw*Math.cos(a),0,spring+3.2*Math.sin(a)]);}
   const vertices=[];for(let i=1;i<edge.length-1;i++)vertices.push(...edge[0],...edge[i],...edge[i+1]);
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
   const mesh=new THREE.Mesh(geometry,material),tx=Math.cos(p.angle),ty=Math.sin(p.angle),k=p.scale;
   mesh.matrixAutoUpdate=false;mesh.matrix.set(-ty*k,tx*k,0,p.p[0],tx*k,ty*k,0,p.p[1],0,p.grade*k,k,p.p[2],0,0,0,1);
   mesh.frustumCulled=false;mesh.userData.portal=p;scene.add(mesh);meshes.push(mesh);
  }},render(renderer,camera,night){
   material.uniforms.night.value=night;
   for(const m of meshes){m.updateMatrixWorld(true);inverse.multiplyMatrices(camera.projectionMatrix,m.matrixWorld).invert();eye.set(0,0,1,0).applyMatrix4(inverse);
     const local=new THREE.Vector3(eye.x/eye.w,eye.y/eye.w,eye.z/eye.w);m.visible=local.y<-.1;if(!m.visible)continue;
     // 遠方入口若被另一座山遮住，不能把開口印到前方山坡上。略過洞口旁的 DEM 平滑過渡。
     const from=new THREE.Vector3(0,0,m.userData.portal.spring).applyMatrix4(m.matrixWorld),to=local.applyMatrix4(m.matrixWorld),length=from.distanceTo(to);
     for(let i=1;i<=8&&m.visible;i++){const d=16+(length-16)*i/9;if(d>=length)break;const p=from.clone().lerp(to,d/length),g=groundAt(p.x,p.y);
       if(Number.isFinite(g)&&g>p.z+2)m.visible=false;
     }
   }
   renderer.render(scene,camera);
  },destroy(){clear();material.dispose();}};
}
